import "dotenv/config";
import dns from "dns";
// Force IPv4 first to avoid IPv6 timeouts with some providers (e.g. Cloudflare/Tripay)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}
import express from "express";
import type { Request as ExpressRequest } from "express";
import cors from "cors";
import authRoutes from "./auth/auth.controller";
import categoryRoutes from "./category/category.controller";
import messageRoutes from "./message/message.controller";
import productRoutes from "./product/product.controller";
import discountRoutes from "./discount/discount.controller";
import ratingsRoutes from "./ratings/ratings.controller";
import tripayRoutes from "./payments/tripay.controller";
import { resolveTripayBaseUrl } from "./payments/tripay.util";
// import typeRoutes from "./type/type.controller";
import colorRoutes from "./color/color.controller";
import objectiveRoutes from "./objective/objective.controller";
import orderRoutes from "./order/order.controller";
import userRoutes from "./user/user.controller";
import cartRoutes from "./cart/cart.controller";
import uploadImageRoutes from "./upload/image.controller";
import { errorHandler } from "./middleware/error.middleware";
import dashboardRoutes from "./dashboard/dashboard.controller";
import ordersAdminRoutes from "./orders/orders.controller";
import emailUtils from "./utils/email.utils";
import { processTripayCallback } from "./payments/tripay.service";
import prisma from "./lib/prisma";
import { authenticate } from "./middleware/auth.middleware";
import { OrderService } from "./order/order.service";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

// Initialize Scheduler
import { initPickupReminderScheduler } from "./scheduler/pickup-reminder.scheduler";

// Import Notification Routes
import notificationRoutes from "./notification/notification.controller";

// Variabel lingkungan sudah dimuat oleh import 'dotenv/config' di atas

// Inisialisasi aplikasi Express
const app = express();
const PORT = Number(process.env.PORT || 4000);
const orderService = new OrderService(prisma as any);
const isProd =
  String(process.env.NODE_ENV || "development").toLowerCase() === "production";
const logger = pinoHttp({
  transport: isProd
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
});

// PENTING: Middleware untuk parsing JSON harus dipasang PERTAMA
// Simpan raw body string untuk verifikasi HMAC webhook (Tripay)
const rawBodySaver = (req: any, _res: any, buf: Buffer) => {
  try {
    if (buf && buf.length) {
      req.rawBody = buf.toString("utf8");
    }
  } catch (_) {
    // abaikan jika gagal menyimpan raw body
  }
};
app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProd ? 100 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(logger);

// Mendukung method override untuk klien/proxy yang membatasi PATCH/PUT/DELETE
// Klien bisa mengirim POST dengan header 'X-HTTP-Method-Override' atau query '_method'
app.use((req, _res, next) => {
  const overrideHeader = req.headers["x-http-method-override"];
  const overrideQuery =
    typeof req.query._method === "string" ? req.query._method : undefined;
  const candidate = (overrideHeader as string | undefined) ?? overrideQuery;
  if (candidate && req.method === "POST") {
    const upper = String(candidate).toUpperCase();
    if (["PUT", "PATCH", "DELETE"].includes(upper)) {
      // Override method untuk kompatibilitas proxy lama
      (req as any).method = upper;
    }
  }
  next();
});

// Fixer untuk prefix ganda: jika request datang ke /api/api/... maka rewrite ke /api/...
// Ini membuat backend toleran terhadap mis-konfigurasi proxy frontend.
app.use((req, _res, next) => {
  if (typeof req.url === "string") {
    if (req.url.startsWith("/api/api/")) {
      req.url = req.url.replace(/^\/api\/api\//, "/api/");
    } else if (req.url.startsWith("/api/v1/")) {
      req.url = req.url.replace(/^\/api\/v1\//, "/api/");
    }
  }
  next();
});

// Static serving for processed uploads
app.use("/uploads", express.static("uploads"));

// Logging ditangani oleh pino-http di atas

// Enable CORS
app.use(
  cors({
    origin: "*", // allow all for dev
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/ratings", ratingsRoutes);
app.use("/api/colors", colorRoutes);
app.use("/api/objectives", objectiveRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/carts", cartRoutes);
app.use("/api/upload", uploadImageRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin/orders", ordersAdminRoutes);
app.use("/api/notifications", notificationRoutes); // Add notification routes

// Payment Routes (Tripay)
app.use("/api/payments/tripay", tripayRoutes);

// Tripay Callback
app.post("/api/callback/tripay", async (req: ExpressRequest, res) => {
  try {
    const result = await processTripayCallback(
      req.body,
      (req as any).rawBody,
      req.headers["x-callback-signature"] as string
    );
    res.json(result);
  } catch (error: any) {
    req.log.error(error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || "Callback failed",
    });
  }
});

// FALLBACK: Handle Tripay callback if sent to root URL (user misconfiguration)
app.post("/", async (req: ExpressRequest, res) => {
  try {
    const event = req.headers["x-callback-event"];
    if (event === "payment_status") {
      const result = await processTripayCallback(
        req.body,
        (req as any).rawBody,
        req.headers["x-callback-signature"] as string
      );
      return res.json(result);
    }
    // If not Tripay event, 404
    return res.status(404).send("Not Found");
  } catch (error: any) {
    req.log.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Error handling middleware
app.use(errorHandler);

// Start Scheduler
initPickupReminderScheduler();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

export default app;