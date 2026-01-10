import { Router, Request, Response } from "express";
import { OrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";
import { OrderService } from "../order/order.service";
import email from "../utils/email.utils";

const router = Router();
const orderService = new OrderService(prisma as any);

const ALLOWED_STATUS = [
  "pending",
  "unpaid",
  "processing",
  "ready",
  "completed",
  "cancelled",
  "all",
] as const;
type AllowedStatus = (typeof ALLOWED_STATUS)[number];

function parseDateRange(dateStr?: string) {
  try {
    // Jika 'date' tidak diberikan, gunakan tanggal HARI INI di zona waktu Asia/Jakarta
    if (!dateStr) {
      try {
        const todayJakarta = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Jakarta",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        dateStr = todayJakarta; // yyyy-MM-dd
      } catch (e) {
        // Fallback jika Asia/Jakarta tidak didukung
        const now = new Date();
        dateStr = now.toISOString().split("T")[0];
      }
    }
    // Validasi format yyyy-MM-dd
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDatePattern.test(dateStr)) {
      return null;
    }
    // Bangun rentang berdasarkan Asia/Jakarta (+07:00)
    // Jika timezone gagal, fallback ke UTC atau local
    const start = new Date(`${dateStr}T00:00:00+07:00`);
    const end = new Date(`${dateStr}T23:59:59.999+07:00`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      // Fallback ke UTC jika offset +07:00 gagal diparse
      const s = new Date(`${dateStr}T00:00:00Z`);
      const e = new Date(`${dateStr}T23:59:59.999Z`);
      return { start: s, end: e };
    }
    return { start, end };
  } catch (error) {
    console.error("Error parsing date range:", error);
    return null;
  }
}

function hashStringToInt(s: string): number {
  // FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// Helper: ambil URL gambar utama dari product.imageUrl (Json) - Disamakan dengan order.controller.ts
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

function buildOrderId(createdAt: Date, srcId: string): string {
  const y = createdAt.getUTCFullYear().toString();
  const m = (createdAt.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = createdAt.getUTCDate().toString().padStart(2, "0");
  const tail = (hashStringToInt(srcId) % 10000).toString().padStart(4, "0");
  return `ORD-${y}${m}${d}-${tail}`;
}

router.get(
  "/",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response) => {
    try {
      // Lazy check: update expired pending orders
      try {
        await orderService.checkExpiredOrders();
      } catch (err) {
        console.error("Lazy checkExpiredOrders failed (non-blocking):", err);
      }

      const dateStr =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const statusStr =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const search =
        typeof req.query.search === "string" ? req.query.search : undefined;
      const pickupStr =
        typeof req.query.pickup === "string" ? req.query.pickup : undefined;
      const pickup = pickupStr
        ? ["true", "1", "yes", "y"].includes(pickupStr.toLowerCase())
        : false;
      // Telemetry ringan: pantau penggunaan pickup-scope di listing
      if (pickup && (statusStr || "").toLowerCase() === "processing") {
        console.log(
          `[Orders] pickup-scope listing used: status=processing date=${
            dateStr || "(today)"
          }`
        );
      }

      const range = parseDateRange(dateStr);
      if (!range) {
        return res.status(400).json({
          error: {
            code: "BAD_REQUEST",
            message: "Format 'date' harus yyyy-MM-dd",
          },
        });
      }

      // Validasi status opsional
      let statusFilter: AllowedStatus = "all";
      if (statusStr) {
        if (!ALLOWED_STATUS.includes(statusStr as AllowedStatus)) {
          return res.status(400).json({
            error: {
              code: "BAD_REQUEST",
              message:
                "status harus salah satu dari pending|processing|ready|completed|cancelled|all",
            },
          });
        }
        statusFilter = statusStr as AllowedStatus;
      }

      // Bangun kondisi pencarian
      const where: any = {};
      // Default: filter berdasarkan createdAt
      let dateField: "createdAt" | "pickupAt" = "createdAt";
      const statusLower = statusStr ? statusStr.toLowerCase() : undefined;
      if (pickup && statusLower === "processing") {
        // Pickup-scope aktif: hanya pesanan PROCESSING dengan jadwal pickup
        dateField = "pickupAt";
        where.pickupAt = { not: null };
      }
      where[dateField] = { gte: range.start, lte: range.end };
      if (statusFilter !== "all") {
        if (statusFilter === "ready") {
          where.status = "READY_FOR_PICKUP" as OrderStatus;
        } else if (statusFilter === "unpaid") {
          where.status = "PENDING" as OrderStatus;
        } else {
          where.status = statusFilter.toUpperCase() as any as OrderStatus;
        }
      }

      // Pencarian bebas di nama/email/phone pengguna dan nama produk
      if (search && search.trim().length > 0) {
        const s = search.trim();
        where.OR = [
          { id: { contains: s } },
          { user: { name: { contains: s, mode: "insensitive" } } },
          { user: { email: { contains: s, mode: "insensitive" } } },
          { user: { phone: { contains: s, mode: "insensitive" } } },
          {
            orderItems: {
              some: { product: { name: { contains: s, mode: "insensitive" } } },
            },
          },
        ];
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  imageUrl: true,
                  size: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const data = orders
        .map((o, index) => {
          try {
            const idNum = hashStringToInt(o.id);
            const uidNum = hashStringToInt(o.userId);

            // Bentuk pickup dari field terstruktur pickupAt bila tersedia
            let pickupDate = "";
            let pickupTime = "";
            let pickupAtIso: string | null = null;
            let pickedUpAtIso: string | null = null;
            if (o.pickupAt) {
              const d = new Date(o.pickupAt as any);
              if (!isNaN(d.getTime())) {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                const hh = String(d.getHours()).padStart(2, "0");
                const min = String(d.getMinutes()).padStart(2, "0");
                pickupDate = `${yyyy}-${mm}-${dd}`;
                pickupTime = `${hh}:${min}`;
                pickupAtIso = d.toISOString();
              }
            }
            if ((o as any) && (o as any).pickedUpAt) {
              const pd = new Date((o as any).pickedUpAt as any);
              if (!isNaN(pd.getTime())) {
                pickedUpAtIso = pd.toISOString();
              }
            }

            return {
              // Identitas konsisten: gunakan UUID utama DB untuk update
              order_id: o.id,
              // Sertakan kode human-readable sebagai reference
              code: buildOrderId(o.createdAt, o.id),
              id: idNum,
              user_id: uidNum,
              customer_name: o.user?.name || "",
              customer_email: o.user?.email || "",
              customer_phone: o.user?.phone || "",
              products: o.orderItems.map((it, idx) => ({
                id: idx + 1, // ordinal per order untuk konsistensi tampilan
                product_id: hashStringToInt(it.productId),
                name: it.product?.name || "",
                image: resolveImageUrl(it.product?.imageUrl), // Gunakan helper resolveImageUrl
                quantity: it.quantity,
                size: it.product?.size || null,
                price:
                  typeof it.price === "number"
                    ? it.price
                    : it.product?.price ?? 0,
              })),
              total_amount: o.totalAmount,
              status: o.status.toLowerCase(), // "pending"|"processing"|...
              pickup_date: pickupDate,
              pickup_time: pickupTime,
              pickupAt: pickupAtIso, // gabungan
              pickup_at: pickupAtIso,
              pickedUpAt: pickedUpAtIso,
              // alias snake_case agar kompatibel dengan frontend
              picked_up_at: pickedUpAtIso,
              picked_up_by: (o as any)?.pickedUpById || null,
              notes: null,
              created_at: o.createdAt.toISOString(),
              updated_at: o.updatedAt.toISOString(),
            };
          } catch (err) {
            console.error(`Error mapping order ${o.id}:`, err);
            return null; // Akan difilter
          }
        })
        .filter(Boolean); // Filter nulls from errors

      return res.status(200).json({ data });
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

router.get(
  "/stats",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response) => {
    try {
      const dateStr =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const pickupStr =
        typeof req.query.pickup === "string" ? req.query.pickup : undefined;
      const pickup = pickupStr
        ? ["true", "1", "yes", "y"].includes(pickupStr.toLowerCase())
        : false;
      const range = parseDateRange(dateStr);
      if (!range) {
        return res.status(400).json({
          error: {
            code: "BAD_REQUEST",
            message: "Format 'date' harus yyyy-MM-dd",
          },
        });
      }

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
          // processing: jika pickup=true, hitung berdasar pickupAt di rentang tanggal
          prisma.order.count({
            where: pickup
              ? {
                  pickupAt: { gte: range.start, lte: range.end },
                  status: "PROCESSING",
                }
              : {
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

      return res.status(200).json({
        data: {
          total,
          pending,
          processing,
          completed,
          cancelled,
          // Transitional compatibility: always 0; deprecated
          picked_up: 0,
        },
        meta: { picked_up_deprecated: true },
      });
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

export default router;

// Alias endpoints untuk invoice di path /orders agar kompatibel dengan frontend lama
// GET /orders/:id/invoice - Unduh invoice sebagai PDF (alias)
router.get(
  "/:id/invoice",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const order = await orderService.findOne(
        id,
        req.user!.userId,
        req.user!.role
      );
      const { generateInvoicePdf } = await import("../utils/invoice.utils");
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
    } catch (err: any) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message:
            err?.message || "Order tidak ditemukan atau tidak berhak mengakses",
        },
      });
    }
  }
);

// GET /orders/:id/invoice/pdf - Unduh invoice sebagai PDF
router.get(
  "/:id/invoice/pdf",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      // Gunakan OrderService agar konsisten dengan struktur order
      const order = await orderService.findOne(
        id,
        req.user!.userId,
        req.user!.role
      );
      const { generateInvoicePdf } = await import("../utils/invoice.utils");
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
    } catch (err: any) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message:
            err?.message || "Order tidak ditemukan atau tidak berhak mengakses",
        },
      });
    }
  }
);

// GET /orders/:id/invoice/preview - Tampilkan PDF inline
router.get(
  "/:id/invoice/preview",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const order = await orderService.findOne(
        id,
        req.user!.userId,
        req.user!.role
      );
      const { generateInvoicePdf } = await import("../utils/invoice.utils");
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
      return res.status(200).send(pdfBuffer);
    } catch (err: any) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message:
            err?.message || "Order tidak ditemukan atau tidak berhak mengakses",
        },
      });
    }
  }
);

// POST /orders/:id/invoice/resend - Admin: kirim ulang invoice PDF via email
router.post(
  "/:id/invoice/resend",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const role = req.user!.role;
      const userId = req.user!.userId;

      // Ambil data order lengkap untuk pembuatan PDF
      const order = await orderService.findOne(id, userId, role);
      const toEmail = (order as any)?.user?.email;
      if (!toEmail) {
        return res.status(400).json({
          error: {
            code: "BAD_REQUEST",
            message: "Email pelanggan tidak tersedia untuk pesanan ini",
          },
        });
      }

      // Hanya izinkan resend jika sudah dibayar atau status telah selesai
      const s = String((order as any).status || "").toUpperCase();
      const isPaidLike = ["PAID", "SUCCESS", "COMPLETED"].includes(s);
      if (!isPaidLike && !(order as any).paidAt) {
        return res.status(400).json({
          error: {
            code: "BAD_REQUEST",
            message:
              "Order belum dibayar/selesai, resend invoice PDF hanya untuk pesanan yang sudah PAID",
          },
        });
      }

      const { generateInvoicePdf } = await import("../utils/invoice.utils");
      const pdfBuffer = await generateInvoicePdf({
        id,
        status: s,
        paymentMethod: String((order as any).paymentMethod || ""),
        paymentMethodCode: (order as any).paymentMethodCode || undefined,
        totalAmount: Number((order as any).totalAmount || 0),
        createdAt: (order as any).createdAt,
        paidAt: (order as any).paidAt || new Date().toISOString(),
        shippingAddress: (order as any).shippingAddress,
        pickupAt: (order as any).pickupAt,
        user: (order as any).user,
        orderItems: (order as any).orderItems,
      });

      const attachments = [
        {
          name: `invoice-${id}.pdf`,
          contentBase64: pdfBuffer.toString("base64"),
        },
      ];

      // Kirim email dengan lampiran PDF
      await email.sendInvoiceEmail({
        toEmail,
        orderId: id,
        amount: Number((order as any).totalAmount || 0),
        paymentMethod: String((order as any).paymentMethod || ""),
        paymentMethodCode: (order as any).paymentMethodCode || undefined,
        items: ((order as any).orderItems || []).map((oi: any) => ({
          name: oi.product?.name || "Produk",
          quantity: oi.quantity,
          price: oi.price,
        })),
        orderUrl: `${
          process.env.APP_BASE_URL || "http://localhost:3000"
        }/orders/${id}/invoice`,
        attachments,
      });

      console.log(
        `[Admin] Resent invoice PDF for order=${id} to=${toEmail} attachmentsCount=${attachments.length}`
      );
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Gagal mengirim ulang invoice PDF",
        },
      });
    }
  }
);

// Admin-only: update order status/pickupAt
router.patch(
  "/:id",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const role = req.user!.role;
      const userId = req.user!.userId;

      const payload: any = {};
      if (typeof req.body.status === "string") {
        payload.status = String(req.body.status).toUpperCase();
        const allowedPatchStatuses = [
          "PENDING",
          "PROCESSING",
          "READY_FOR_PICKUP",
          "COMPLETED",
          "CANCELLED",
        ];
        if (payload.status === "PICKED_UP") {
          return res.status(422).json({
            error: {
              code: "UNPROCESSABLE_ENTITY",
              message: "Status PICKED_UP tidak lagi didukung",
            },
          });
        }
        if (!allowedPatchStatuses.includes(payload.status)) {
          return res.status(400).json({
            error: {
              code: "BAD_REQUEST",
              message:
                "status harus salah satu dari PENDING|PROCESSING|READY_FOR_PICKUP|COMPLETED|CANCELLED",
            },
          });
        }
      }
      if (typeof req.body.pickupAt === "string") {
        payload.pickupAt = req.body.pickupAt;
      }
      // Alias toleran: pickup_at
      if (
        typeof (req.body as any).pickup_at === "string" &&
        !payload.pickupAt
      ) {
        payload.pickupAt = (req.body as any).pickup_at;
      }
      // Opsi kompatibilitas: terima pickup_date + pickup_time, normalisasikan ke pickupAt (Asia/Jakarta)
      const pickupDateStr =
        typeof req.body.pickup_date === "string"
          ? req.body.pickup_date
          : undefined;
      const pickupTimeStr =
        typeof req.body.pickup_time === "string"
          ? req.body.pickup_time
          : undefined;
      if (pickupDateStr && pickupTimeStr) {
        const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
        const timePattern = /^\d{2}:\d{2}$/;
        if (
          isoDatePattern.test(pickupDateStr) &&
          timePattern.test(pickupTimeStr)
        ) {
          const composed = `${pickupDateStr}T${pickupTimeStr}:00+07:00`;
          const d = new Date(composed);
          if (!isNaN(d.getTime())) {
            payload.pickupAt = d.toISOString();
          }
        }
      }
      if (typeof req.body.shippingAddress === "string") {
        payload.shippingAddress = req.body.shippingAddress;
      }

      const updated = await orderService.update(id, payload, userId, role);
      return res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: err?.message || "Gagal memperbarui pesanan",
        },
      });
    }
  }
);

// GET /today - daftar pesanan hari ini (admin-only), opsional status=all
router.get(
  "/today",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response) => {
    try {
      const statusStr =
        typeof req.query.status === "string" ? req.query.status : undefined;

      let statusFilter: AllowedStatus = "all";
      if (statusStr) {
        if (!ALLOWED_STATUS.includes(statusStr as AllowedStatus)) {
          return res.status(400).json({
            error: {
              code: "BAD_REQUEST",
              message:
                "status harus salah satu dari pending|processing|ready|completed|cancelled|all",
            },
          });
        }
        statusFilter = statusStr as AllowedStatus;
      }

      // Rentang hari ini berdasarkan Asia/Jakarta
      const todayJakarta = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const { start, end } = parseDateRange(todayJakarta)!;

      const where: any = { createdAt: { gte: start, lte: end } };
      if (statusFilter !== "all") {
        where.status =
          statusFilter === "ready"
            ? "READY_FOR_PICKUP"
            : statusFilter.toUpperCase();
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  imageUrl: true,
                  size: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const data = orders.map((o) => ({
        order_id: o.id,
        code: buildOrderId(o.createdAt, o.id),
        customer_name: o.user?.name || "",
        customer_email: o.user?.email || "",
        customer_phone: o.user?.phone || "",
        total_amount: o.totalAmount,
        status: o.status.toLowerCase(),
        // Konsisten: kirim jadwal ambil jika tersedia
        ...(o.pickupAt
          ? (() => {
              const d = new Date(o.pickupAt as any);
              if (!isNaN(d.getTime())) {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                const hh = String(d.getHours()).padStart(2, "0");
                const min = String(d.getMinutes()).padStart(2, "0");
                return {
                  pickup_date: `${yyyy}-${mm}-${dd}`,
                  pickup_time: `${hh}:${min}`,
                  pickupAt: d.toISOString(),
                  pickup_at: d.toISOString(),
                };
              }
              return {};
            })()
          : {}),
        // Alias snake_case untuk data picked up
        ...((o as any).pickedUpAt
          ? (() => {
              const pd = new Date((o as any).pickedUpAt as any);
              if (!isNaN(pd.getTime())) {
                return { picked_up_at: pd.toISOString() };
              }
              return {};
            })()
          : {}),
        picked_up_by: (o as any)?.pickedUpById || null,
        created_at: o.createdAt.toISOString(),
        updated_at: o.updatedAt.toISOString(),
      }));

      return res.status(200).json({ data });
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
