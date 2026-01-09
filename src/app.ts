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

console.log("Starting application...");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("PORT:", process.env.PORT);

// Global Error Handlers
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION! Shutting down...");
  console.error(err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION! Shutting down...");
  console.error(err);
  process.exit(1);
});

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

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1", userRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/messages", messageRoutes);
app.use("/api/v1/discounts", discountRoutes);
app.use("/api/v1/ratings", ratingsRoutes);
app.use("/api/v1/colors", colorRoutes);
app.use("/api/v1/objectives", objectiveRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/carts", cartRoutes);
app.use("/api/v1/upload", uploadImageRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/admin/orders", ordersAdminRoutes);
app.use("/api/v1/notifications", notificationRoutes); // Add notification routes

// Payment Routes (Tripay)
app.use("/api/v1/payments/tripay", tripayRoutes);

// Root route untuk mengecek status server
app.get("/", (req, res) => {
  res.send("Backend Meesha is running! 🚀");
});

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

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
  });
}

export default app;
