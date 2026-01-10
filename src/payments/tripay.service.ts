import { buildSignature, resolveTripayBaseUrl } from "./tripay.util";
import email from "../utils/email.utils";
import { generateInvoicePdf } from "../utils/invoice.utils";
import prisma from "../lib/prisma";
import { invalidatePrefix } from "../utils/cache";
import { NotificationService } from "../notification/notification.service";
import { PrismaClient } from "@prisma/client";
import { DiscountService } from "../discount/discount.service";

const getHeaders = () => ({
  Authorization: `Bearer ${process.env.TRIPAY_API_KEY}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  // Gunakan UA umum agar tidak diperlakukan sebagai bot oleh Cloudflare
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
  Connection: "keep-alive",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "https://tripay.co.id",
  Referer: "https://tripay.co.id/",
});

// Simple in-memory cache for payment channels
let channelsCache: any[] = [];
let channelsCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export const getPaymentChannels = async (code?: string) => {
  const apiKey = process.env.TRIPAY_API_KEY || "";
  if (!apiKey) {
    const err: any = new Error("TRIPAY_API_KEY tidak terpasang");
    err.status = 500;
    throw err;
  }

  // Check cache first
  const now = Date.now();
  if (channelsCache.length > 0 && now - channelsCacheTime < CACHE_TTL) {
    if (code) {
      return channelsCache.filter(
        (c: any) => c.code === code || c.group === code
      );
    }
    return channelsCache;
  }

  const base = resolveTripayBaseUrl();
  // Always fetch all channels to populate cache
  const url = `${base}/merchant/payment-channel`;

  // Retry logic (max 3 retries)
  let lastError: any;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        headers: getHeaders(),
        redirect: "follow",
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        const friendly =
          res.status === 403
            ? "Channel sementara tidak dapat dimuat, coba lagi dalam 1–2 menit"
            : `Tripay returned non-JSON (${
                res.status
              }). Head: ${contentType}. Body: ${text.substring(
                0,
                200
              )}. URL=${url}`;
        const err: any = new Error(friendly);
        err.status = res.status;
        throw err;
      }

      const json: any = await res.json();
      if (!res.ok || json?.success === false) {
        const err: any = new Error(
          json?.message || `Tripay channels error: ${res.status}`
        );
        err.status = res.status;
        throw err;
      }

      // Update cache
      channelsCache = json?.data || [];
      channelsCacheTime = now;

      if (code) {
        return channelsCache.filter(
          (c: any) => c.code === code || c.group === code
        );
      }
      return channelsCache;
    } catch (e) {
      lastError = e;
      // Wait 1s before retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Fallback: If all retries failed, use static data to prevent UI from breaking
  console.warn(
    `[Tripay] Failed to fetch channels after 3 attempts: ${
      lastError?.message || "Unknown error"
    }`
  );
  console.warn(
    "[Tripay] Using FALLBACK channels data because Tripay is unreachable."
  );

  const FALLBACK_CHANNELS = [
    {
      code: "MYBVA",
      name: "Maybank Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "PERMATAVA",
      name: "Permata Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "BNIVA",
      name: "BNI Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "BRIVA",
      name: "BRI Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "MANDIRIVA",
      name: "Mandiri Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "BCAVA",
      name: "BCA Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "BSIVA",
      name: "BSI Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "CIMBVA",
      name: "CIMB Niaga Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "DANAMONVA",
      name: "Danamon Virtual Account",
      group: "Virtual Account",
      fee_merchant: 4000,
      fee_customer: 4000,
      total_fee: 4000,
      active: true,
    },
    {
      code: "QRIS",
      name: "QRIS",
      group: "QRIS",
      fee_merchant: 750,
      fee_customer: 750,
      total_fee: 750,
      active: true,
    },
    {
      code: "OVO",
      name: "OVO",
      group: "E-Wallet",
      fee_merchant: 0,
      fee_customer: 0,
      total_fee: 0,
      active: true,
    },
    {
      code: "SHOPEEPAY",
      name: "ShopeePay",
      group: "E-Wallet",
      fee_merchant: 0,
      fee_customer: 0,
      total_fee: 0,
      active: true,
    },
    {
      code: "DANA",
      name: "DANA",
      group: "E-Wallet",
      fee_merchant: 0,
      fee_customer: 0,
      total_fee: 0,
      active: true,
    },
    {
      code: "ALFAMART",
      name: "Alfamart",
      group: "Retail",
      fee_merchant: 0,
      fee_customer: 0,
      total_fee: 0,
      active: true,
    },
    {
      code: "INDOMARET",
      name: "Indomaret",
      group: "Retail",
      fee_merchant: 0,
      fee_customer: 0,
      total_fee: 0,
      active: true,
    },
  ];

  // Update cache with fallback so we don't spam error logs
  channelsCache = FALLBACK_CHANNELS;
  channelsCacheTime = now;

  if (code) {
    return channelsCache.filter(
      (c: any) => c.code === code || c.group === code
    );
  }
  return channelsCache;
};

export const createClosedTransaction = async (params: {
  orderId: string;
  amount: number;
  method: string; // e.g., BNIVA, BRIVA, MANDIRIVA, BCAVA, QRIS
  customer: { name: string; email: string; phone?: string };
  items: Array<{ sku?: string; name: string; price: number; quantity: number }>;
  expired_time?: number; // epoch seconds TTL per Tripay
  expiredTime?: number; // alias compatibility from frontend
}) => {
  const apiKey = process.env.TRIPAY_API_KEY || "";
  if (!apiKey) {
    const err: any = new Error("TRIPAY_API_KEY tidak terpasang");
    err.status = 500;
    throw err;
  }
  const merchantCode = process.env.TRIPAY_MERCHANT_CODE || "";
  const privateKey = process.env.TRIPAY_PRIVATE_KEY || "";
  const base = resolveTripayBaseUrl();

  if (!merchantCode || !privateKey) {
    throw new Error(
      "Tripay env not set (TRIPAY_MERCHANT_CODE/TRIPAY_PRIVATE_KEY)"
    );
  }

  const merchantRef = params.orderId;
  // Hitung ulang amount dari order_items agar konsisten dengan persyaratan Tripay
  const items = Array.isArray(params.items) ? params.items : [];
  const computedAmount = items.reduce(
    (sum, it) => sum + Number(it.price || 0) * Number(it.quantity || 0),
    0
  );
  // Gunakan amount yang dikirim (bisa jadi sudah didiskon) atau fallback ke computed
  // Jika amount dikirim, kita percayai controller sudah memvalidasinya
  const finalAmount =
    params.amount && Number.isFinite(params.amount) && params.amount > 0
      ? params.amount
      : Number.isFinite(computedAmount)
      ? computedAmount
      : 0;
  const signature = buildSignature(
    privateKey,
    merchantCode,
    merchantRef,
    finalAmount
  );

  // Audit log ringkas untuk pembuatan transaksi
  try {
    const ttl = Number.isFinite(params.expired_time)
      ? params.expired_time
      : Number.isFinite(params.expiredTime)
      ? params.expiredTime
      : undefined;
    console.info(
      `[Tripay CreateClosed] merchant_ref=${merchantRef} method=${
        params.method
      } amount=${finalAmount} items=${items.length} ttl=${ttl || "-"}s`
    );
  } catch (_) {}

  const payload: any = {
    method: params.method,
    merchant_ref: merchantRef,
    amount: finalAmount,
    customer_name: params.customer.name,
    customer_email: params.customer.email,
    customer_phone: params.customer.phone,
    order_items: items.map((it) => ({
      sku: it.sku,
      name: it.name,
      price: it.price,
      quantity: it.quantity,
    })),
    // Gunakan TRIPAY_CALLBACK_URL jika tersedia; fallback ke CALLBACK_URL
    callback_url: process.env.TRIPAY_CALLBACK_URL || process.env.CALLBACK_URL,
    return_url: `${(
      process.env.APP_BASE_URL || "http://localhost:3000"
    ).replace(/\/$/, "")}/payment?order=${encodeURIComponent(merchantRef)}`,
    signature,
  };

  // Forward TTL when provided by frontend (seconds since epoch)
  const ttlSec = Number.isFinite(params.expired_time)
    ? params.expired_time
    : Number.isFinite(params.expiredTime)
    ? params.expiredTime
    : undefined;
  if (Number.isFinite(ttlSec as number)) {
    payload.expired_time = ttlSec;
  }

  const url = `${base}/transaction/create`;
  const res = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    const friendly =
      res.status === 403
        ? "Transaksi sementara tidak dapat diproses, coba lagi dalam 1–2 menit"
        : `Tripay returned non-JSON (${
            res.status
          }). Head: ${contentType}. Body: ${text.substring(0, 200)}`;
    const err: any = new Error(friendly);
    err.status = res.status;
    throw err;
  }
  const json: any = await res.json();
  if (!res.ok || json?.success === false) {
    const err: any = new Error(
      json?.message || `Tripay create error: ${res.status}`
    );
    err.status = res.status;
    throw err;
  }
  return json?.data || json;
};

export const processTripayCallback = async (
  payload: any,
  rawBody?: string,
  headerSignature?: string
) => {
  console.log("--- [Tripay Callback Start] ---");
  console.log("Headers Signature:", headerSignature);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const merchantCode = process.env.TRIPAY_MERCHANT_CODE || "";
  const privateKey = process.env.TRIPAY_PRIVATE_KEY || "";
  if (!merchantCode || !privateKey) {
    console.error("[Tripay Callback] Missing ENV credentials");
    throw new Error("Tripay env not set");
  }

  // 1) Verifikasi signature HMAC-SHA256 terhadap RAW BODY
  const raw =
    typeof rawBody === "string" && rawBody.length > 0 ? rawBody : undefined;
  const sigHeader = headerSignature || payload?.signature || "";

  if (raw) {
    const expectedHmac = require("crypto")
      .createHmac("sha256", privateKey)
      .update(raw)
      .digest("hex");

    if (String(sigHeader).toLowerCase() !== expectedHmac.toLowerCase()) {
      console.error(
        `[Tripay Callback] Invalid Signature (Raw Body). Expected: ${expectedHmac}, Received: ${sigHeader}`
      );
      const err: any = new Error("Invalid signature");
      err.status = 403;
      throw err;
    }
  } else {
    // Fallback kompatibilitas lama: verifikasi model signature merchantCode+merchant_ref+amount
    const { merchant_ref, amount, signature } = payload || {};
    const expected = buildSignature(
      privateKey,
      merchantCode,
      String(merchant_ref),
      Number(amount)
    );
    if (String(signature).toLowerCase() !== expected.toLowerCase()) {
      console.error(
        `[Tripay Callback] Invalid Signature (Manual Build). Expected: ${expected}, Received: ${signature}`
      );
      const err: any = new Error("Invalid signature");
      err.status = 403;
      throw err;
    }
  }

  console.log("[Tripay Callback] Signature Valid. Processing Order...");

  // 2) Parse payload dari raw bila tersedia untuk konsistensi
  let p = payload || {};
  try {
    if (raw) {
      p = JSON.parse(raw);
    }
  } catch (_) {
    // jika parse gagal, tetap gunakan payload yang ada
  }

  const merchant_ref: string = String(p.merchant_ref || "");
  const reference: string | undefined = p.reference
    ? String(p.reference)
    : undefined;
  const status: string = String(p.status || "");
  const payment_method: string | undefined = p.payment_method || p.method;
  const payment_method_code: string | undefined =
    p.payment_method_code || p.channel || undefined;
  const amountNum: number = Number(p.total_amount ?? p.amount ?? 0);

  // Audit log ringkas untuk callback
  try {
    console.info(
      `[Tripay Callback] merchant_ref=${merchant_ref} reference=${
        reference || "-"
      } status=${status} amount=${amountNum}`
    );
  } catch (_) {}

  // Opsi: jika TRIPAY_COMPLETE_ON_PAID=true, langsung tandai sebagai COMPLETED ketika pembayaran berhasil
  const completeOnPaidEnv = String(
    process.env.TRIPAY_COMPLETE_ON_PAID || "false"
  ).toLowerCase();
  const completeOnPaid = ["1", "true", "yes", "y"].includes(completeOnPaidEnv);

  let newStatus:
    | "PENDING"
    | "PROCESSING"
    | "CANCELLED"
    | "COMPLETED"
    | undefined;
  const s = status.toUpperCase();
  const isPaid = s === "PAID" || s === "SUCCESS" || s === "COMPLETED";
  if (isPaid) newStatus = completeOnPaid ? "COMPLETED" : "PROCESSING";
  // pembayaran berhasil → masuk antrian proses admin
  else if (s === "PENDING") newStatus = "PENDING";
  else if (s === "EXPIRED" || s === "FAILED" || s === "CANCELLED")
    newStatus = "CANCELLED";

  // 3) Update order dengan idempotensi dan simpan metadata pembayaran
  if (merchant_ref) {
    const order = await prisma.order.findUnique({
      where: { id: merchant_ref },
      include: {
        user: { select: { email: true, name: true, phone: true } },
        orderItems: {
          select: {
            productId: true,
            quantity: true,
            price: true,
            product: { select: { name: true, imageUrl: true } },
          },
        },
      },
    });
    if (order) {
      // Idempoten: jika sudah paid dan callback juga mengindikasikan paid, abaikan update
      const sUpperIncoming = String(status || "").toUpperCase();
      const incomingIsPaid =
        sUpperIncoming === "PAID" ||
        sUpperIncoming === "SUCCESS" ||
        sUpperIncoming === "COMPLETED";
      const alreadyPaid = Boolean((order as any).paidAt);
      if (alreadyPaid && incomingIsPaid) {
        try {
          console.info(
            `[Tripay Callback] Skip update (idempoten) untuk order=${merchant_ref} karena sudah paid.`
          );
        } catch (_) {}
        return { success: true, ok: true, status: order.status };
      }

      // Validasi amount dari callback vs total order items (IDR tidak memerlukan pembulatan)
      try {
        const expectedAmount = ((order as any).orderItems || []).reduce(
          (sum: number, it: any) =>
            sum + Number(it.price || 0) * Number(it.quantity || 0),
          0
        );
        if (
          Number.isFinite(amountNum) &&
          Number.isFinite(expectedAmount) &&
          amountNum > 0 &&
          expectedAmount > 0 &&
          Number(amountNum) !== Number(expectedAmount)
        ) {
          const err: any = new Error(
            `Amount mismatch pada callback: expected=${expectedAmount} received=${amountNum}`
          );
          err.status = 400;
          // Log audit agar mudah dilacak
          try {
            console.warn(
              `[Tripay Callback] Amount mismatch order=${merchant_ref} expected=${expectedAmount} received=${amountNum}`
            );
          } catch (_) {}
          throw err;
        }
      } catch (_) {
        // Jika validasi gagal karena data, jangan blokir; lanjutkan
      }

      const current = String(order.status || "").toUpperCase();
      const target = (newStatus || current).toUpperCase();

      // Allow resurrection from CANCELLED if payment is successful (late payment)
      // Only COMPLETED is strictly terminal for incoming payments
      const isTerminal = current === "COMPLETED";

      const isAlreadyProcessing =
        current === "PROCESSING" && target !== "COMPLETED";

      const data: any = {};
      // Logic: Update status if not terminal, OR if it was CANCELLED but now Paid
      // Note: isTerminal check is now simpler because we know "COMPLETED" is terminal for incoming.
      // TypeScript narrowing might fail if we compare specific literal types with overlapping checks,
      // so we use generic string comparison or cast to 'string' if needed, but here logic is fine.

      const isResurrection = current === "CANCELLED" && isPaid;
      const shouldUpdate =
        (!isTerminal || isResurrection) &&
        !(isAlreadyProcessing && target !== "PROCESSING");

      if (shouldUpdate) {
        if (newStatus && current !== target) {
          data.status = newStatus;
        }
      }

      // Metadata pembayaran & waktu paid
      if (isPaid) {
        data.paidAt = new Date();

        // 3.6) Kirim notifikasi email ke Admin (khusus admin) saat pesanan dibayar
        // Pastikan ini hanya dikirim sekali (saat transisi ke PAID)
        const wasPaidBefore = Boolean((order as any).paidAt);
        if (!wasPaidBefore) {
          try {
            const adminSubject = `[Admin] Pesanan Dibayar #${merchant_ref}`;
            const adminMsg = `Pesanan #${merchant_ref} telah dibayar oleh user ${
              order.user?.name || "Guest"
            } (${order.user?.email || "-"}). Total: Rp${Number(
              amountNum || (order as any).totalAmount || 0
            ).toLocaleString("id-ID")}. Metode: ${
              payment_method || (order as any).paymentMethod || "-"
            }. Status: ${target}.`;

            // Kirim email ke admin
            await email.sendAdminNotification(adminSubject, adminMsg);
            console.info(
              `[Tripay Callback] Admin email notification sent for order #${merchant_ref}`
            );

            // 3.7) Kirim notifikasi In-App ke semua Admin
            const admins = await prisma.user.findMany({
              where: { role: "ADMIN" },
              select: { id: true },
            });
            const notificationService = new NotificationService(prisma);
            for (const admin of admins) {
              await notificationService.create({
                userId: admin.id,
                title: "Pesanan Baru Dibayar",
                message: `Order #${merchant_ref} telah dibayar. Segera proses pesanan ini.`,
                type: "INFO",
                link: `/dashboard/orders/${order.id}`,
              });
            }
            console.info(
              `[Tripay Callback] Admin in-app notifications sent to ${admins.length} admins`
            );
          } catch (e) {
            console.error(
              `[Tripay Callback] Failed to send admin notification:`,
              e
            );
          }
        }

        // Record Discount Usage if not already recorded
        // Note: discountService.recordUsage handles idempotency (P2002)
        if ((order as any).discountCode && (order as any).userId) {
          try {
            const discountService = new DiscountService(prisma);
            // Use non-blocking promise or await depending on requirement.
            // Await is safer to ensure it's recorded before we finish.
            await discountService.recordUsage(
              (order as any).discountCode,
              (order as any).userId,
              merchant_ref
            );
            console.info(
              `[Tripay Callback] Recorded discount usage: ${
                (order as any).discountCode
              }`
            );
          } catch (e) {
            console.error(
              `[Tripay Callback] Failed to record discount usage:`,
              e
            );
            // Do not throw, as payment is already successful.
          }
        }
      }
      if (typeof payment_method === "string" && payment_method.trim()) {
        data.paymentMethod = payment_method;
      }
      if (
        typeof payment_method_code === "string" &&
        payment_method_code.trim()
      ) {
        data.paymentMethodCode = payment_method_code;
      }
      if (typeof reference === "string" && reference.trim()) {
        data.tripayReference = reference;
      }
      if (Number.isFinite(amountNum) && amountNum > 0) {
        data.totalAmount = amountNum;
      }

      if (Object.keys(data).length > 0) {
        try {
          // Update Stock & Sold Count jika status menjadi PAID/PROCESSING/COMPLETED
          if (isPaid) {
            const items = (order as any).orderItems || [];
            // Gunakan Promise.all atau transaction terpisah agar tidak memblokir update status order jika gagal?
            // Namun user minta "otomatis", sebaiknya best effort.
            // Kita bungkus try-catch agar kegagalan update stock tidak menggagalkan callback sepenuhnya,
            // atau biarkan throw jika konsistensi data sangat penting.
            try {
              await prisma.$transaction(
                items.map((item: any) =>
                  prisma.product.update({
                    where: { id: item.productId },
                    data: {
                      stock: { decrement: item.quantity },
                      sold: { increment: item.quantity },
                    },
                  })
                )
              );
            } catch (stockErr) {
              console.error(
                "[Tripay Callback] Failed to update stock/sold:",
                stockErr
              );
            }
          }

          await prisma.order.update({ where: { id: merchant_ref }, data });

          // Jika status menjadi COMPLETED atau PROCESSING, invalidate cache rekomendasi
          if (data.status === "COMPLETED" || data.status === "PROCESSING") {
            invalidatePrefix("recs:v2:");
          }
        } catch (e) {
          // Jika kolom belum ada (sebelum migrasi), hindari menggagalkan webhook
          // dan hanya update status bila memungkinkan
          if (data.status && Object.keys(data).length === 1) {
            await prisma.order.update({
              where: { id: merchant_ref },
              data: { status: data.status },
            });
          }
        }
      }

      // 3.5) Kirim email invoice (opsional) saat pembayaran berhasil, idempoten
      const emailEnabled = String(
        process.env.EMAIL_INVOICE_ENABLED || "false"
      ).toLowerCase();
      const shouldSendEmail = ["1", "true", "yes", "y"].includes(emailEnabled);
      const wasPaidBefore = Boolean((order as any).paidAt);
      if (shouldSendEmail && isPaid && !wasPaidBefore) {
        const toEmail = (order as any).user?.email;
        if (toEmail) {
          const items = ((order as any).orderItems || []).map((oi: any) => ({
            name: oi.product?.name || "Produk",
            quantity: oi.quantity,
            price: oi.price,
          }));
          const orderUrlBase =
            process.env.APP_BASE_URL || "http://localhost:3000";
          const orderUrl = `${orderUrlBase}/orders/${merchant_ref}/invoice`;
          try {
            const attachPdfEnv = String(
              process.env.EMAIL_INVOICE_ATTACH_PDF || "true"
            ).toLowerCase();
            const shouldAttachPdf = ["1", "true", "yes", "y"].includes(
              attachPdfEnv
            );
            let attachments:
              | { name: string; contentBase64: string }[]
              | undefined;
            if (shouldAttachPdf) {
              try {
                const pdfBuffer = await generateInvoicePdf({
                  id: merchant_ref,
                  status: String(
                    data.status || order.status || ""
                  ).toUpperCase(),
                  paymentMethod: payment_method || order.paymentMethod,
                  paymentMethodCode:
                    payment_method_code || order.paymentMethodCode || undefined,
                  totalAmount: Number(amountNum || order.totalAmount || 0),
                  createdAt: order.createdAt as any,
                  paidAt: new Date().toISOString(),
                  shippingAddress: (order as any).shippingAddress,
                  pickupAt: (order as any).pickupAt,
                  user: (order as any).user,
                  orderItems: (order as any).orderItems,
                });
                attachments = [
                  {
                    name: `invoice-${merchant_ref}.pdf`,
                    contentBase64: pdfBuffer.toString("base64"),
                  },
                ];
              } catch (_) {}
            }

            await email.sendInvoiceEmail({
              toEmail,
              orderId: merchant_ref,
              amount: Number(amountNum || order.totalAmount || 0),
              paymentMethod: payment_method || order.paymentMethod,
              paymentMethodCode:
                payment_method_code || order.paymentMethodCode || undefined,
              items,
              orderUrl,
              attachments,
            });
          } catch (_) {
            // Jangan gagalkan webhook bila email gagal
          }
        }
      }

      // 3.6) Kirim notifikasi email ke Admin (khusus admin) saat pesanan dibayar
      if (isPaid && !wasPaidBefore) {
        try {
          const adminSubject = `[Admin] Pesanan Dibayar #${merchant_ref}`;
          const adminMsg = `Pesanan #${merchant_ref} telah dibayar oleh user ${
            order.user?.name || "Guest"
          } (${order.user?.email || "-"}). Total: Rp${Number(
            amountNum || order.totalAmount || 0
          ).toLocaleString("id-ID")}. Metode: ${
            payment_method || order.paymentMethod || "-"
          }. Status: ${target}.`;
          await email.sendAdminNotification(adminSubject, adminMsg);
          console.info(
            `[Tripay Callback] Admin email notification sent for order #${merchant_ref}`
          );

          // 3.7) Kirim notifikasi In-App ke semua Admin
          const admins = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true },
          });
          const notificationService = new NotificationService(prisma);
          for (const admin of admins) {
            await notificationService.create({
              userId: admin.id,
              title: "Pesanan Baru Dibayar",
              message: `Order #${merchant_ref} telah dibayar. Segera proses pesanan ini.`,
              type: "INFO",
              link: `/dashboard/orders/${order.id}`,
            });
          }
          console.info(
            `[Tripay Callback] Admin in-app notifications sent to ${admins.length} admins`
          );
        } catch (e) {
          console.error(
            `[Tripay Callback] Failed to send admin notification:`,
            e
          );
        }
      }

      // 4) Pembersihan cart dipindah ke titik aman: status final (PAID/EXPIRED)
      const sUpper = s.toUpperCase();
      const shouldClear =
        sUpper === "PAID" ||
        sUpper === "SUCCESS" ||
        sUpper === "COMPLETED" ||
        sUpper === "EXPIRED";
      if (shouldClear && order.userId) {
        try {
          await prisma.cart.deleteMany({ where: { userId: order.userId } });
        } catch (_) {
          // Jangan gagalkan webhook jika pembersihan cart error
        }
      }
    }
  }

  return { success: true, ok: true, status: newStatus };
};

export const getTransactionDetail = async (params: {
  merchantRef?: string;
  reference?: string;
}): Promise<any> => {
  const apiKey = process.env.TRIPAY_API_KEY || "";
  if (!apiKey) {
    const err: any = new Error("TRIPAY_API_KEY tidak terpasang");
    err.status = 500;
    throw err;
  }

  // Jika reference belum ada tapi merchantRef ada, coba cari reference di database lokal dulu
  // Ini mengatasi masalah di mana endpoint Tripay /transaction/detail mewajibkan parameter 'reference'
  // dan menolak 'merchant_ref' (terutama di beberapa versi API atau mode).
  let effectiveReference = params.reference;
  if (!effectiveReference && params.merchantRef) {
    try {
      const localOrder = await prisma.order.findUnique({
        where: { id: params.merchantRef },
        select: { tripayReference: true },
      });
      if (localOrder?.tripayReference) {
        effectiveReference = localOrder.tripayReference;
      }
    } catch (_) {
      // Abaikan error DB, lanjutkan dengan parameter asli
    }
  }

  const base = resolveTripayBaseUrl();
  const qs = effectiveReference
    ? `reference=${encodeURIComponent(String(effectiveReference))}`
    : `merchant_ref=${encodeURIComponent(String(params.merchantRef || ""))}`;
  const url = `${base}/transaction/detail?${qs}`;

  try {
    const res = await fetch(url, { headers: getHeaders(), redirect: "follow" });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      const friendly =
        res.status === 403
          ? "Detail transaksi sementara tidak dapat diambil, coba lagi nanti"
          : `Tripay returned non-JSON (${
              res.status
            }). Head: ${contentType}. Body: ${text.substring(
              0,
              200
            )}. URL=${url}`;
      const err: any = new Error(friendly);
      err.status = res.status;
      throw err;
    }

    const json: any = await res.json();
    if (!res.ok || json?.success === false) {
      const msg = json?.message || `Tripay detail error: ${res.status}`;
      const err: any = new Error(msg);

      // Map Tripay "not found" errors to 404 consistently
      const isNotFound = /not found|tidak ditemukan|data tidak ada/i.test(msg);
      if (res.status === 404 || (res.status === 400 && isNotFound)) {
        err.status = 404;
      } else {
        err.status = res.status;
      }
      throw err;
    }

    const d = json?.data || {};
    // Normalisasi field agar cocok dengan kebutuhan frontend
    const expiredTime =
      typeof d.expired_time === "number"
        ? d.expired_time
        : d.expired_at
        ? Math.floor(new Date(d.expired_at).getTime() / 1000)
        : undefined;

    let qrImage: string | undefined =
      d.qr_image || d.qr_url || d.qr_svg || undefined;
    const maybeBase64 =
      typeof qrImage === "string" &&
      /^[A-Za-z0-9+/=]+$/.test(qrImage.slice(0, 100));
    if (qrImage && maybeBase64 && !qrImage.startsWith("data:")) {
      qrImage = `data:image/png;base64,${qrImage}`;
    }

    const normalized = {
      status: String(d.status || d.status_message || "").toUpperCase(),
      merchant_ref: d.merchant_ref ?? params.merchantRef,
      reference: d.reference ?? params.reference,
      amount: Number(d.amount ?? 0),
      method: d.method || d.payment_method || d.channel,
      channel: d.channel || d.method,
      payment_method: d.method || d.payment_method || d.channel,
      payment_name: d.payment_name || d.channel || d.method,
      pay_code: d.pay_code || d.va_number || d.account_number,
      va_number: d.va_number || d.pay_code,
      qr_image: qrImage,
      qr_url: qrImage,
      qr_string: d.qr_string,
      expired_time: expiredTime,
      expired_at:
        d.expired_at ||
        (expiredTime ? new Date(expiredTime * 1000).toISOString() : undefined),
      instructions: Array.isArray(d.instructions) ? d.instructions : [],
      payment_url: d.payment_url || d.checkout_url || d.pay_url,
    };

    // Auto-reconcile: sinkronkan status Order di database berdasarkan status Tripay saat endpoint ini dipanggil
    try {
      const refId = String(normalized.merchant_ref || "");
      if (refId) {
        const order = await prisma.order.findUnique({
          where: { id: refId },
          select: { status: true },
        });
        if (order) {
          const s = normalized.status;
          let newStatus: "PENDING" | "PROCESSING" | "CANCELLED" | undefined;
          const su = s.toUpperCase();
          if (su === "PAID" || su === "SUCCESS" || su === "COMPLETED")
            newStatus = "PROCESSING";
          else if (su === "PENDING" || su === "UNPAID") newStatus = "PENDING";
          else if (su === "EXPIRED" || su === "FAILED" || su === "CANCELLED")
            newStatus = "CANCELLED";

          if (newStatus) {
            const current = String(order.status || "").toUpperCase();
            const target = newStatus.toUpperCase();
            const isTerminal =
              current === "COMPLETED" || current === "CANCELLED";
            const isAlreadyProcessing =
              current === "PROCESSING" && target !== "COMPLETED";

            // Izinkan revive dari CANCELLED → PENDING jika status Tripay masih PENDING/UNPAID
            const canRevive = current === "CANCELLED" && target === "PENDING";

            if (
              (!isTerminal || canRevive) &&
              !(isAlreadyProcessing && target !== "PROCESSING")
            ) {
              if (current !== target) {
                await prisma.order.update({
                  where: { id: refId },
                  data: { status: newStatus },
                });
              }
            }
          }
        }
      }
    } catch (_) {
      // Jangan ganggu response jika update status gagal; cukup diam
    }

    return normalized;
  } catch (error: any) {
    // 1. Resolve Order ID from Reference if needed (untuk self-healing/fallback)
    let resolvedOrderId = params.merchantRef;
    if (!resolvedOrderId && params.reference) {
      try {
        const o = await prisma.order.findFirst({
          where: { tripayReference: params.reference },
          select: { id: true },
        });
        if (o) resolvedOrderId = o.id;
      } catch (_) {}
    }

    // SELF-HEALING: Jika transaksi tidak ditemukan di Tripay (404/400) tapi ada di DB (PENDING),
    // kita coba buat ulang transaksi tersebut agar user bisa bayar.
    if ((error.status === 404 || error.status === 400) && resolvedOrderId) {
      try {
        const order = await prisma.order.findUnique({
          where: { id: resolvedOrderId },
          include: {
            user: true,
            orderItems: { include: { product: true } },
          },
        });

        // Hanya self-heal jika order masih PENDING dan metode pembayaran sudah dipilih
        if (
          order &&
          (String(order.status) === "PENDING" ||
            String(order.status) === "UNPAID") &&
          order.paymentMethodCode
        ) {
          console.log(
            `[Tripay Self-Heal] Re-creating missing transaction for order ${order.id}`
          );

          // Reconstruct items
          const items = order.orderItems.map((oi) => ({
            sku: oi.productId,
            name: oi.product.name,
            price: Number(oi.price),
            quantity: oi.quantity,
          }));

          const created = await createClosedTransaction({
            orderId: order.id,
            amount: Number(order.totalAmount),
            method: order.paymentMethodCode,
            customer: {
              name: order.user.name,
              email: order.user.email,
              phone: order.user.phone || undefined,
            },
            items: items,
          });

          // Panggil ulang detail dengan reference yang baru dibuat
          if (created?.reference) {
            return getTransactionDetail({ reference: created.reference });
          }
        }
      } catch (healError) {
        console.error("[Tripay Self-Heal] Failed:", healError);
        // Jika self-heal gagal, lempar error asli
      }
    }

    // Fallback: If Tripay fails (404/400) but we have the order locally, return local data
    // This allows the payment page to load (with "Unpaid" status) even if Tripay transaction is missing.
    if (resolvedOrderId) {
      try {
        const local = await prisma.order.findUnique({
          where: { id: resolvedOrderId },
        });
        if (local) {
          return {
            status: local.status === "PENDING" ? "UNPAID" : local.status,
            merchant_ref: local.id,
            reference: local.tripayReference || null,
            amount: Number(local.totalAmount),
            payment_method: local.paymentMethod,
            payment_method_code: local.paymentMethodCode,
            expired_time: local.paymentExpiresAt
              ? Math.floor(local.paymentExpiresAt.getTime() / 1000)
              : undefined,
            instructions: [],
            is_local_fallback: true,
          };
        }
      } catch (_) {}
    }

    throw error;
  }
};

export default {
  getPaymentChannels,
  createClosedTransaction,
  processTripayCallback,
  getTransactionDetail,
};
