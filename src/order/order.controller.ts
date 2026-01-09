import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { OrderService } from "./order.service";
import { CreateOrderDto, UpdateOrderDto } from "../types/order";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";
import { generateInvoicePdf } from "../utils/invoice.utils";
import email from "../utils/email.utils";
import { calculateMinPickupAt } from "../utils/pickup";
import { invalidatePrefix } from "../utils/cache";
import {
  getPickupConfig,
  toUtcFromJakarta,
  addMinutes,
  isWithinOperatingHours,
  computeSlotEndHHmm,
  sameDayBufferSatisfied,
  daysFromTodayJakarta,
} from "../utils/timezone";

const router = Router();
const orderService = new OrderService(prisma);

// Helper: map status DB/Tripay ke enum frontend
const mapStatusToFrontend = (
  status: string
): "pending" | "processing" | "ambil" | "completed" | "cancelled" => {
  const s = String(status || "").toUpperCase();
  if (s === "NEW" || s === "PENDING" || s === "UNPAID") return "pending";
  if (s === "PROCESSING" || s === "IN_PROGRESS") return "processing";
  if (s === "READY_FOR_PICKUP") return "ambil";
  if (s === "PAID" || s === "SUCCESS" || s === "COMPLETED") return "completed";
  if (
    s === "CANCELLED" ||
    s === "FAILED" ||
    s === "EXPIRED" ||
    s === "REFUNDED"
  )
    return "cancelled";
  // default fallback
  return "pending";
};

// Helper: ambil URL gambar utama dari product.imageUrl (Json)
const resolveImageUrl = (imageUrl: any): string => {
  try {
    if (!imageUrl) return "";
    // Jika array of strings
    if (Array.isArray(imageUrl) && typeof imageUrl[0] === "string") {
      return String(imageUrl[0]);
    }
    // Jika array of objects dengan field url
    if (
      Array.isArray(imageUrl) &&
      imageUrl[0] &&
      typeof imageUrl[0] === "object"
    ) {
      const first = imageUrl[0];
      return String(first.url || first.secure_url || "");
    }
    // Jika object tunggal
    if (typeof imageUrl === "object" && imageUrl) {
      return String(
        (imageUrl as any).url || (imageUrl as any).secure_url || ""
      );
    }
    // Jika string tunggal
    if (typeof imageUrl === "string") return imageUrl;
  } catch {}
  return "";
};

// Helper: konversi record Prisma Order (+user +items+product) ke DTO frontend
const toFrontendOrder = (
  order: any,
  index: number,
  ratingsMap: Record<string, any> = {}
) => {
  const items = Array.isArray(order.orderItems) ? order.orderItems : [];
  const products = items.map((it: any, itemIdx: number) => {
    const pid = String(it.productId || it.product?.id || "");
    const rating = ratingsMap[pid];
    return {
      id: it.id || `${order.id}-${itemIdx}`, // Gunakan ID unik dari OrderItem
      product_id: pid,
      name: String(it.product?.name || ""),
      image: resolveImageUrl(it.product?.imageUrl),
      quantity: Number(it.quantity || 0),
      size: String(it.product?.size || ""),
      price: Number(it.price || it.product?.price || 0),
      user_rating: rating
        ? {
            id: rating.id,
            rating: rating.rating,
            comment: rating.comment,
            reply: rating.reply,
            replyAt: rating.replyAt,
            createdAt: rating.createdAt,
          }
        : null,
    };
  });
  const totalAmount = products.reduce(
    (sum: number, p: any) =>
      sum + Number(p.price || 0) * Number(p.quantity || 0),
    0
  );
  let pickupDate = "";
  let pickupTime = "";
  const pickSource = order.pickupStart || order.pickupAt;
  if (pickSource) {
    const d = new Date(pickSource);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      pickupDate = `${yyyy}-${mm}-${dd}`;
      pickupTime = `${hh}:${min}`;
    }
  }

  return {
    id: index + 1,
    order_id: String(order.id),
    customer_name: String(order.user?.name || ""),
    customer_email: String(order.user?.email || ""),
    customer_phone: String(order.user?.phone || ""),
    products,
    total_amount: Number.isFinite(totalAmount)
      ? totalAmount
      : Number(order.totalAmount || 0),
    status: mapStatusToFrontend(order.status),
    // pickup_status: representasi status pengambilan untuk tab "Ambil"
    pickup_status: (() => {
      const s = String(order.pickupStatus || "").toUpperCase();
      if (s === "READY_FOR_PICKUP") return "ready_for_pickup";
      if (s === "SCHEDULED") return "scheduled";
      if (s === "MISSED") return "missed";
      if (s === "UNSCHEDULED") return "unscheduled";
      return "unscheduled";
    })(),
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    notes: String(order.shippingAddress || ""),
    created_at: new Date(order.createdAt).toISOString(),
    updated_at: new Date(order.updatedAt).toISOString(),
    pickup_ready_at: (() => {
      const d = order.pickupReadyAt ? new Date(order.pickupReadyAt) : undefined;
      return d && !isNaN(d.getTime()) ? d.toISOString() : undefined;
    })(),
    payment_expires_at: order.paymentExpiresAt
      ? new Date(order.paymentExpiresAt).toISOString()
      : undefined,
    paymentMethod: order.paymentMethod || "Bank Transfer", // Ubah ke camelCase
    paymentMethodCode: order.paymentMethodCode || undefined, // Tambahkan paymentMethodCode
    paymentExpiresAt: order.paymentExpiresAt // Tambahkan camelCase agar sesuai frontend
      ? new Date(order.paymentExpiresAt).toISOString()
      : undefined,
    tripayReference: order.tripayReference || undefined, // Tambahkan tripayReference
  };
};

// Helper: parse rentang tanggal yyyy-MM-dd ke UTC start/end
function parseDateRange(dateStr?: string) {
  if (!dateStr) {
    const now = new Date();
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );
    const end = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999
      )
    );
    return { start, end };
  }
  const start = new Date(`${dateStr}T00:00:00Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);
  return { start, end };
}

// GET /api/orders - Get all orders (admin) or user's orders
router.get(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;

      // Default filter 'all' agar frontend menerima semua data dan bisa filter client-side
      const qStatus = String(req.query.status || "all").toLowerCase();

      // FIXED: Removed invalid statuses (UNPAID, NEW) that caused Prisma errors
      const statusFilterMap: Record<string, string[]> = {
        pending: ["PENDING"],
        unpaid: ["PENDING"],
        processing: ["PROCESSING"],
        ambil: ["READY_FOR_PICKUP"], // Tab khusus jika diperlukan
        completed: ["COMPLETED", "PICKED_UP"],
        cancelled: ["CANCELLED"],
        all: [],
      };

      const statusFilter = statusFilterMap[qStatus];

      // Jika status tidak dikenali atau 'all', jangan filter status (tapi default kita 'pending')
      // Kecuali user eksplisit minta ?status=all
      const whereStatus =
        statusFilter && statusFilter.length > 0
          ? { status: { in: statusFilter as any } }
          : {};

      let orders: any[] = [];

      // Setup query dasar
      const queryOptions = {
        where: {
          ...(role !== "ADMIN" ? { userId: userId! } : {}),
          ...whereStatus,
        },
        include: {
          user: { select: { name: true, email: true, phone: true } },
          orderItems: {
            include: {
              product: true,
            },
          },
          ratings: true,
        },
        orderBy: { createdAt: "desc" } as any,
      };

      console.log(
        `[getOrders] userId=${userId} role=${role} qStatus=${qStatus} whereStatus=${JSON.stringify(
          whereStatus
        )}`
      );

      orders = await prisma.order.findMany(queryOptions);
      console.log(`[getOrders] Found ${orders.length} orders directly from DB`);
      if (orders.length > 0) {
        console.log(
          `[getOrders] Sample Order IDs: ${orders
            .slice(0, 3)
            .map((o) => o.id)
            .join(", ")}`
        );
        console.log(
          `[getOrders] Sample Order Statuses: ${orders
            .slice(0, 3)
            .map((o) => o.status)
            .join(", ")}`
        );
      }

      const now = new Date();
      const skewMs = Number(process.env.EXPIRY_SKEW_MS || "120000");

      orders.forEach((order) => {
        if (
          order.status === "PENDING" &&
          order.paymentExpiresAt &&
          new Date(order.paymentExpiresAt).getTime() + skewMs < now.getTime()
        ) {
          console.log(
            `[getOrders] Auto-cancelling expired order ${order.id}. Expires=${order.paymentExpiresAt}, Now=${now}`
          );
          order.status = "CANCELLED";
        }
      });

      // Re-filter: Jika status berubah karena expired (misal jadi CANCELLED),
      // pastikan ia tidak ikut termuat jika user sedang memfilter status tertentu (misal 'pending').
      if (statusFilter && statusFilter.length > 0) {
        orders = orders.filter((o) => statusFilter.includes(o.status));
      }

      // Map ke bentuk DTO frontend dan bungkus { data }
      const dto = orders.map((o, i) => {
        const ratingsMap: Record<string, any> = {};
        if (Array.isArray(o.ratings)) {
          o.ratings.forEach((r: any) => {
            if (r.productId) {
              ratingsMap[r.productId] = r;
            }
          });
        }
        return toFrontendOrder(o, i, ratingsMap);
      });
      res.status(200).json({ data: dto });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/orders/:id - Get order detail
router.get(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      // Gunakan orderService.findOne yang sudah ada logic validasi ownership
      const order = (await orderService.findOne(id, userId!, role!)) as any;

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order tidak ditemukan",
        });
      }

      // Format response sesuai kebutuhan frontend (DTO)
      // Gunakan logic yang sama dengan getOrders (toFrontendOrder)
      const ratingsMap: Record<string, any> = {};
      if (Array.isArray(order.ratings)) {
        order.ratings.forEach((r: any) => {
          if (r.productId) {
            ratingsMap[r.productId] = r;
          }
        });
      }

      const dto = toFrontendOrder(order, 0, ratingsMap);

      // Bungkus dalam { data: ... }
      return res.status(200).json({ data: dto });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/orders/:id/invoice/pdf - Unduh invoice sebagai PDF
router.get(
  "/:id/invoice/pdf",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      const order = (await orderService.findOne(id, userId!, role!)) as any;
      const pdfBuffer = await generateInvoicePdf({
        id,
        status: String(order.status || "").toUpperCase(),
        paymentMethod: String((order as any).paymentMethod || ""),
        paymentMethodCode: (order as any).paymentMethodCode || undefined,
        totalAmount: Number((order as any).totalAmount || 0),
        createdAt: (order as any).createdAt,
        paidAt: (order as any).paidAt,
        shippingAddress: (order as any).shippingAddress,
        pickupAt: (order as any).pickupAt,
        user: (order as any).user,
        orderItems: (order as any).orderItems,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${id}.pdf"`
      );
      return res.status(200).send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/orders/:id/invoice/preview - Tampilkan PDF inline (tanpa content-disposition)
router.get(
  "/:id/invoice/preview",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      const order = await orderService.findOne(id, userId!, role!);
      const pdfBuffer = await generateInvoicePdf({
        id,
        status: String(order.status || "").toUpperCase(),
        paymentMethod: String((order as any).paymentMethod || ""),
        paymentMethodCode: (order as any).paymentMethodCode || undefined,
        totalAmount: Number((order as any).totalAmount || 0),
        createdAt: (order as any).createdAt,
        paidAt: (order as any).paidAt,
        shippingAddress: (order as any).shippingAddress,
        pickupAt: (order as any).pickupAt,
        user: (order as any).user,
        orderItems: (order as any).orderItems,
      });

      res.setHeader("Content-Type", "application/pdf");
      // Tidak mengatur Content-Disposition agar frontend proxy bisa menampilkan inline
      return res.status(200).send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/orders/:id/invoice/resend - Kirim ulang invoice via email
router.post(
  "/:id/invoice/resend",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      const order = await orderService.findOne(id, userId!, role!);

      const requestedEmailRaw =
        typeof req.body?.email === "string" ? req.body.email : undefined;
      const requestedEmail = (requestedEmailRaw || "").trim();
      const toEmail = requestedEmail || String(order.user?.email || "").trim();
      if (!toEmail) {
        return res.status(400).json({
          success: false,
          message:
            "Email tujuan tidak tersedia. Berikan body { email } atau pastikan order memiliki email pengguna.",
        });
      }

      const items = (order.orderItems || []).map((oi: any) => ({
        name: oi.product?.name || "Produk",
        quantity: oi.quantity,
        price: oi.price,
      }));

      const orderUrlBase = process.env.APP_BASE_URL || "http://localhost:3000";
      const orderUrl = `${orderUrlBase}/orders/${id}/invoice`;

      // Tentukan apakah perlu melampirkan PDF berdasarkan env atau override body.attachPdf
      const attachPdfEnv = String(
        process.env.EMAIL_INVOICE_ATTACH_PDF || "false"
      ).toLowerCase();
      const envAttach = ["1", "true", "yes", "y"].includes(attachPdfEnv);
      const bodyAttach = Boolean(req.body?.attachPdf === true);
      const shouldAttachPdf = envAttach || bodyAttach;

      let attachments: { name: string; contentBase64: string }[] | undefined;
      if (shouldAttachPdf) {
        try {
          const pdfBuffer = await generateInvoicePdf({
            id,
            status: String(order.status || "").toUpperCase(),
            paymentMethod: String(order.paymentMethod || ""),
            totalAmount: Number(order.totalAmount || 0),
            createdAt: order.createdAt as any,
            paidAt: order.paidAt as any,
            shippingAddress: (order as any).shippingAddress,
            pickupAt: (order as any).pickupAt,
            user: (order as any).user,
            orderItems: (order as any).orderItems,
          });
          attachments = [
            {
              name: `invoice-${id}.pdf`,
              contentBase64: pdfBuffer.toString("base64"),
            },
          ];
        } catch (_) {}
      }

      await email.sendInvoiceEmail({
        toEmail,
        orderId: id,
        amount: Number(order.totalAmount || 0),
        paymentMethod: String(order.paymentMethod || ""),
        paymentMethodCode: (order as any).paymentMethodCode || undefined,
        items,
        orderUrl,
        attachments,
      });

      return res
        .status(200)
        .json({ success: true, message: "Invoice berhasil dikirim" });
    } catch (error) {
      const message = (error as any)?.message || "Gagal mengirim invoice";
      return res.status(500).json({ success: false, message });
    }
  }
);

// GET /api/orders/stats - Admin dashboard stats (alias untuk /orders/stats)
router.get(
  "/stats",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response) => {
    try {
      const dateStr =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const range = parseDateRange(dateStr)!;

      const [total, pending, processing, completed, cancelled] =
        await Promise.all([
          prisma.order.count({
            where: { createdAt: { gte: range.start, lte: range.end } },
          }),
          prisma.order.count({
            where: {
              createdAt: { gte: range.start, lte: range.end },
              status: "PENDING",
            },
          }),
          prisma.order.count({
            where: {
              createdAt: { gte: range.start, lte: range.end },
              status: "PROCESSING",
            },
          }),
          prisma.order.count({
            where: {
              createdAt: { gte: range.start, lte: range.end },
              status: "COMPLETED",
            },
          }),
          prisma.order.count({
            where: {
              createdAt: { gte: range.start, lte: range.end },
              status: "CANCELLED",
            },
          }),
        ]);

      return res
        .status(200)
        .json({ data: { total, pending, processing, completed, cancelled } });
    } catch (err: any) {
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Server error",
        },
      });
    }
  }
);

// GET /api/orders/:id - Get order by ID
router.get(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      const result = await orderService.findOne(id, userId!, role!);

      // Jika order COMPLETED, fetch ratings untuk items
      let ratingsMap: Record<string, any> = {};
      if (
        (result as any).status === "COMPLETED" &&
        ((result as any).userId === userId || role === "ADMIN")
      ) {
        const ratings = await prisma.productRating.findMany({
          where: {
            orderId: id,
            ...(role !== "ADMIN" ? { userId: userId! } : {}),
          },
        });
        ratings.forEach((r) => {
          ratingsMap[r.productId] = r;
        });
      }

      const dto = toFrontendOrder(result, 0, ratingsMap);
      res.status(200).json({ data: dto });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/orders/:id/invoice - Preview invoice sebagai PDF inline (alias ke /invoice/preview)
router.get(
  "/:id/invoice",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      const order = await orderService.findOne(id, userId!, role!);

      const pdfBuffer = await generateInvoicePdf({
        id,
        status: String(order.status || "").toUpperCase(),
        paymentMethod: String((order as any).paymentMethod || ""),
        paymentMethodCode: (order as any).paymentMethodCode || undefined,
        totalAmount: Number((order as any).totalAmount || 0),
        createdAt: (order as any).createdAt,
        paidAt: (order as any).paidAt,
        shippingAddress: (order as any).shippingAddress,
        pickupAt: (order as any).pickupAt,
        user: (order as any).user,
        orderItems: (order as any).orderItems,
      });

      // Preview inline: hanya set Content-Type tanpa attachment
      res.setHeader("Content-Type", "application/pdf");
      return res.status(200).send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/orders/:id/invoice/download - Unduh invoice sebagai PDF
router.get(
  "/:id/invoice/download",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      // Ambil detail order untuk membentuk invoice
      const order = await orderService.findOne(id, userId!, role!);

      // Hasilkan PDF menggunakan util yang sama seperti endpoint /invoice/pdf
      const pdfBuffer = await generateInvoicePdf({
        id,
        status: String(order.status || "").toUpperCase(),
        paymentMethod: String(order.paymentMethod || ""),
        totalAmount: Number(order.totalAmount || 0),
        createdAt: order.createdAt as any,
        paidAt: (order as any).paidAt as any,
        shippingAddress: (order as any).shippingAddress,
        pickupAt: (order as any).pickupAt,
        user: (order as any).user,
        orderItems: (order as any).orderItems,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${id}.pdf"`
      );
      return res.status(200).send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/orders - Create new order
router.post(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      // Normalisasi jadwal ambil: dukung pickupAt langsung, pickupAtLocal + pickupTimezone, atau pickup_date + pickup_time
      let normalizedPickupAt: string | undefined = undefined;
      const rawPickupAt =
        typeof req.body?.pickupAt === "string" ? req.body.pickupAt : undefined;
      const rawPickupAtLocal =
        typeof req.body?.pickupAtLocal === "string"
          ? req.body.pickupAtLocal
          : undefined;
      const rawPickupTimezone =
        typeof req.body?.pickupTimezone === "string"
          ? req.body.pickupTimezone
          : undefined;
      const rawPickupDate =
        typeof req.body?.pickup_date === "string"
          ? req.body.pickup_date
          : undefined;
      const rawPickupTime =
        typeof req.body?.pickup_time === "string"
          ? req.body.pickup_time
          : undefined;

      if (
        rawPickupAtLocal &&
        rawPickupAtLocal.trim().length &&
        rawPickupTimezone
      ) {
        // Format lokal 'YYYY-MM-DDTHH:mm' + zona waktu. Saat ini dukung Asia/Jakarta (UTC+7)
        const m =
          /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(
            rawPickupAtLocal.trim()
          );
        if (m && /Asia\/Jakarta/i.test(String(rawPickupTimezone))) {
          const y = parseInt(m[1], 10);
          const mo = parseInt(m[2], 10) - 1;
          const d = parseInt(m[3], 10);
          const hh = parseInt(m[4], 10);
          const mm = parseInt(m[5], 10);
          // Konversi ke UTC dengan mengurangi offset 7 jam
          const utc = new Date(Date.UTC(y, mo, d, hh - 7, mm, 0, 0));
          normalizedPickupAt = utc.toISOString();
        }
      } else if (rawPickupAt && rawPickupAt.trim().length) {
        normalizedPickupAt = rawPickupAt.trim();
      } else if (
        rawPickupDate &&
        rawPickupDate.trim().length &&
        rawPickupTime &&
        rawPickupTime.trim().length
      ) {
        // Bentuk ISO dari tanggal + jam (HH:mm) lokal; simpan sebagai string ISO
        const dateOnly = new Date(rawPickupDate);
        if (!isNaN(dateOnly.getTime())) {
          const [hhStr, mmStr] = String(rawPickupTime).split(":");
          const hh = parseInt(hhStr || "0", 10);
          const mm = parseInt(mmStr || "0", 10);
          // Gunakan tahun/bulan/tanggal dari dateOnly, set jam-menit
          // Anggap input lokal Asia/Jakarta, konversi ke UTC
          const utc = new Date(
            Date.UTC(
              dateOnly.getFullYear(),
              dateOnly.getMonth(),
              dateOnly.getDate(),
              (Number.isFinite(hh) ? hh : 0) - 7,
              Number.isFinite(mm) ? mm : 0,
              0,
              0
            )
          );
          normalizedPickupAt = utc.toISOString();
        }
      }

      const createOrderDto: CreateOrderDto = {
        ...req.body,
        ...(normalizedPickupAt ? { pickupAt: normalizedPickupAt } : {}),
        userId: userId!,
        discountCode: req.body.discountCode,
      };

      try {
        console.log(
          "[OrderController] Creating order with payload:",
          JSON.stringify(createOrderDto, null, 2)
        );
        const result = await orderService.create(createOrderDto);
        console.log("[OrderController] Order created successfully:", result.id);
        return res.status(201).json({ success: true, data: result });
      } catch (err: any) {
        console.error("[OrderController] Error creating order:", err);
        const msg = String(err?.message || "Gagal membuat pesanan");
        // Jika validasi pickupAt gagal, kembalikan 422 beserta minPickupAt
        if (Number(err?.status) === 422 || /pickupAt/i.test(msg)) {
          try {
            const items: any[] = Array.isArray(req.body?.orderItems)
              ? req.body.orderItems
              : [];
            const ids = items.map((it) => String(it.productId));
            const products = await prisma.product.findMany({
              where: { id: { in: ids } },
              select: { availability: true } as any,
            });
            const availabilities = products.map((p) =>
              String((p as any)?.availability || "READY").toUpperCase()
            );
            const minPickup = calculateMinPickupAt(
              new Date(),
              availabilities as any
            );
            return res.status(422).json({
              error: {
                code: "VALIDATION_ERROR",
                message: msg,
                minPickupAt: minPickup.toISOString(),
              },
            });
          } catch (_) {
            return res.status(422).json({
              error: { code: "VALIDATION_ERROR", message: msg },
            });
          }
        }
        return next(err);
      }
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/orders/:id - Update order
router.patch(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;
      // Normalisasi payload agar sesuai dengan enum/status di DB
      const payload: any = {};
      if (typeof req.body.status === "string") {
        const upper = String(req.body.status).toUpperCase();
        const allowed = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];
        if (!allowed.includes(upper)) {
          return res.status(400).json({
            error: {
              code: "BAD_REQUEST",
              message:
                "status harus salah satu dari pending|processing|completed|cancelled",
            },
          });
        }
        payload.status = upper;
      }
      if (typeof req.body.pickupAt === "string") {
        payload.pickupAt = req.body.pickupAt;
      }
      if (typeof req.body.shippingAddress === "string") {
        payload.shippingAddress = req.body.shippingAddress;
      }

      const result = await orderService.update(id, payload, userId!, role!);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      const message = (error as any)?.message || "Gagal memperbarui pesanan";
      res.status(400).json({ error: { code: "BAD_REQUEST", message } });
    }
  }
);

// DELETE /api/orders/:id - Delete order (admin only)
router.delete(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const role = req.user?.role;

      if (role !== "ADMIN") {
        return res
          .status(403)
          .json({ message: "Only admins can delete orders" });
      }

      await orderService.remove(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/orders/user/:userId - Get orders by user ID (admin only)
router.get(
  "/user/:userId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const role = req.user?.role;

      if (role !== "ADMIN") {
        return res
          .status(403)
          .json({ message: "Only admins can view other users' orders" });
      }

      const results = await orderService.findByUserId(userId);
      res.status(200).json(results);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/orders/:id/pay - Tandai sudah dibayar (user atau admin)
router.patch(
  "/:id/pay",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          user: { select: { id: true } },
          orderItems: { select: { productId: true, quantity: true } },
        },
      });
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (role !== "ADMIN" && order.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      if (order.status !== "PENDING") {
        return res
          .status(409)
          .json({ message: "Order bukan dalam status PENDING" });
      }
      // Jika paymentExpiresAt tersedia dan sudah lewat, tolak
      const expires = (order as any).paymentExpiresAt;
      if (expires && new Date(expires).getTime() < Date.now()) {
        return res.status(409).json({ message: "Pembayaran kedaluwarsa" });
      }

      // Update Order Status & Product Stock (Decrement Stock, Increment Sold)
      const [updated] = await prisma.$transaction([
        prisma.order.update({
          where: { id },
          data: { status: "PROCESSING", paidAt: new Date() },
          include: { orderItems: { include: { product: true } }, user: true },
        }),
        ...(order.orderItems || []).map((item) =>
          prisma.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: item.quantity },
              sold: { increment: item.quantity },
            },
          })
        ),
      ]);

      // Invalidate cache rekomendasi
      invalidatePrefix("recs:v2:");

      return res
        .status(200)
        .json({ success: true, data: toFrontendOrder(updated as any, 0) });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/orders/:id/cancel - Batalkan pesanan (user atau admin)
router.patch(
  "/:id/cancel",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      const role = req.user?.role;

      // Gunakan service.update untuk memulihkan stok otomatis
      const updated = await orderService.update(
        id,
        { status: "CANCELLED" },
        userId!,
        role!
      );
      return res
        .status(200)
        .json({ success: true, data: toFrontendOrder(updated as any, 0) });
    } catch (error) {
      const message = (error as any)?.message || "Gagal membatalkan pesanan";
      // Konflik status/otorisasi
      return res.status(409).json({ error: { code: "CONFLICT", message } });
    }
  }
);

// PATCH /api/orders/:id/pickup-at - Admin ubah jadwal pickup sekali waktu
router.patch(
  "/:id/pickup-at",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const pickupAtStr =
        typeof req.body?.pickupAt === "string" ? req.body.pickupAt : undefined;
      const pickupAtLocal =
        typeof req.body?.pickupAtLocal === "string"
          ? req.body.pickupAtLocal
          : undefined;
      const pickupTimezone =
        typeof req.body?.pickupTimezone === "string"
          ? req.body.pickupTimezone
          : undefined;
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason : undefined;
      if (!(pickupAtStr || (pickupAtLocal && pickupTimezone)) || !reason) {
        return res.status(400).json({
          message:
            "Body harus berisi { pickupAt: ISOString } atau { pickupAtLocal: 'YYYY-MM-DDTHH:mm', pickupTimezone: 'Asia/Jakarta' } dan { reason: string }",
        });
      }
      let pickupAt: Date | undefined;
      if (pickupAtLocal && /Asia\/Jakarta/i.test(String(pickupTimezone))) {
        const m =
          /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(
            pickupAtLocal.trim()
          );
        if (m) {
          const y = parseInt(m[1], 10);
          const mo = parseInt(m[2], 10) - 1;
          const d = parseInt(m[3], 10);
          const hh = parseInt(m[4], 10);
          const mm = parseInt(m[5], 10);
          pickupAt = new Date(Date.UTC(y, mo, d, hh - 7, mm, 0, 0));
        }
      }
      if (!pickupAt && pickupAtStr) {
        pickupAt = new Date(pickupAtStr);
      }
      if (!pickupAt || isNaN(pickupAt.getTime())) {
        return res.status(400).json({ message: "pickupAt tidak valid" });
      }
      const order = await prisma.order.findUnique({
        where: { id },
        include: { orderItems: { include: { product: true } }, user: true },
      });
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Validasi terhadap minPickupAt dan jam operasional
      const availabilities = (order.orderItems || []).map((oi: any) =>
        String((oi.product as any)?.availability || "READY").toUpperCase()
      );
      const minPickup = calculateMinPickupAt(new Date(), availabilities as any);
      if (pickupAt.getTime() < minPickup.getTime()) {
        return res.status(422).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "pickupAt lebih cepat dari minimum yang diizinkan",
            minPickupAt: minPickup.toISOString(),
          },
        });
      }
      const { open, close } = getPickupConfig();
      const hh = String(
        new Date(pickupAt.getTime() + 7 * 3600 * 1000).getUTCHours()
      ).padStart(2, "0");
      const mm = String(
        new Date(pickupAt.getTime() + 7 * 3600 * 1000).getUTCMinutes()
      ).padStart(2, "0");
      const hhmm = `${hh}:${mm}`;
      // Gunakan urutan parameter yang benar: open, close, candidate
      if (!isWithinOperatingHours(open, close, hhmm)) {
        return res.status(422).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "pickupAt di luar jam operasional",
          },
        });
      }

      // Append ke riwayat perubahan
      const history = Array.isArray((order as any).pickupHistory)
        ? ((order as any).pickupHistory as any[])
        : [];
      const entry = {
        changedAt: new Date().toISOString(),
        by: "ADMIN",
        reason,
        pickupAt: pickupAt.toISOString(),
      };
      history.push(entry);

      const updated = await prisma.order.update({
        where: { id },
        data: { pickupAt, pickupHistory: history } as any,
        include: { orderItems: { include: { product: true } }, user: true },
      });
      return res
        .status(200)
        .json({ success: true, data: toFrontendOrder(updated as any, 0) });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/orders/:id/pickup-schedule
router.post(
  "/:id/pickup-schedule",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const role = req.user?.role;
      const userId = req.user?.userId;

      const order = (await prisma.order.findUnique({
        where: { id },
        include: {
          orderItems: {
            include: {
              product: {
                // Cast ke any untuk menjaga kompatibilitas tipe Prisma yang mungkin belum terbarui
                select: { fulfillmentType: true, leadTimeDays: true } as any,
              },
            },
          },
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      })) as any;
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (role !== "ADMIN" && order.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const date =
        typeof req.body?.date === "string" ? req.body.date : undefined;
      const start =
        typeof req.body?.start === "string" ? req.body.start : undefined;
      if (!date || !start) {
        return res.status(400).json({
          message: "Body harus berisi { date: 'YYYY-MM-DD', start: 'HH:mm' }",
        });
      }

      const { open, close, slotMinutes, bufferMinutes } = getPickupConfig();
      const endHHmm = computeSlotEndHHmm(start, slotMinutes);

      if (
        !isWithinOperatingHours(open, close, start) ||
        !isWithinOperatingHours(open, close, endHHmm)
      ) {
        return res
          .status(400)
          .json({ message: "Waktu di luar jam operasional" });
      }

      const leadDays = Math.max(
        0,
        ...order.orderItems.map((oi: any) =>
          oi.product?.fulfillmentType === "PREORDER"
            ? oi.product?.leadTimeDays || 0
            : 0
        )
      );
      const daysFromToday = daysFromTodayJakarta(date);
      if (daysFromToday < leadDays) {
        return res.status(409).json({
          message: `Jadwal terlalu dekat. Minimal +${leadDays} hari untuk preorder.`,
        });
      }

      if (!sameDayBufferSatisfied(date, start, bufferMinutes)) {
        return res.status(409).json({
          message:
            "Jadwal terlalu dekat dengan waktu sekarang (buffer same-day).",
        });
      }

      const pickupStartUtc = toUtcFromJakarta(date, start);
      const pickupEndUtc = addMinutes(pickupStartUtc, slotMinutes);

      const updated = await prisma.order.update({
        where: { id },
        data: {
          pickupStatus: "SCHEDULED",
          pickupStart: pickupStartUtc,
          pickupEnd: pickupEndUtc,
          scheduledAt: new Date(),
        } as any,
        include: { orderItems: { include: { product: true } }, user: true },
      });

      return res
        .status(200)
        .json({ success: true, data: toFrontendOrder(updated as any, 0) });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/orders/:id/reschedule (admin only)
router.patch(
  "/:id/reschedule",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const date =
        typeof req.body?.date === "string" ? req.body.date : undefined;
      const start =
        typeof req.body?.start === "string" ? req.body.start : undefined;
      if (!date || !start) {
        return res.status(400).json({
          message: "Body harus berisi { date: 'YYYY-MM-DD', start: 'HH:mm' }",
        });
      }
      const { open, close, slotMinutes } = getPickupConfig();
      const endHHmm = computeSlotEndHHmm(start, slotMinutes);
      if (
        !isWithinOperatingHours(open, close, start) ||
        !isWithinOperatingHours(open, close, endHHmm)
      ) {
        return res
          .status(400)
          .json({ message: "Waktu di luar jam operasional" });
      }

      const pickupStartUtc = toUtcFromJakarta(date, start);
      const pickupEndUtc = addMinutes(pickupStartUtc, slotMinutes);

      const updated = await prisma.order.update({
        where: { id },
        data: {
          pickupStatus: "SCHEDULED",
          pickupStart: pickupStartUtc,
          pickupEnd: pickupEndUtc,
          scheduledAt: new Date(),
        } as any,
        include: { orderItems: { include: { product: true } }, user: true },
      });
      return res
        .status(200)
        .json({ success: true, data: toFrontendOrder(updated as any, 0) });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/orders/:id/status (admin only)
router.patch(
  "/:id/status",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const status = String(req.body?.pickupStatus || "").toUpperCase();
      const allowed = [
        "UNSCHEDULED",
        "SCHEDULED",
        "READY_FOR_PICKUP",
        // "PICKED_UP" deprecated
        "MISSED",
      ];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "pickupStatus tidak valid" });
      }
      const data: any = { pickupStatus: status };
      if (status === "READY_FOR_PICKUP") data.readyAt = new Date();
      const updated = await prisma.order.update({
        where: { id },
        data: data as any,
        include: { orderItems: { include: { product: true } }, user: true },
      });
      return res
        .status(200)
        .json({ success: true, data: toFrontendOrder(updated as any, 0) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
