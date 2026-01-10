import { PrismaClient } from "@prisma/client";
import { CreateOrderDto, UpdateOrderDto } from "../types/order";
import { HttpError } from "../utils/http-error";
import { calculateMinPickupAt } from "../utils/pickup";
import {
  getPickupConfig,
  isWithinOperatingHours,
  toJakartaHHmm,
} from "../utils/timezone";
import { invalidatePrefix } from "../utils/cache";
import { DiscountService } from "../discount/discount.service";

export class OrderService {
  constructor(private prisma: PrismaClient) {}

  public async checkExpiredOrders(userId?: string) {
    try {
      const skewMs = Number(process.env.EXPIRY_SKEW_MS || "120000");
      const cutoff = new Date(Date.now() - skewMs);

      // Find candidates first for logging
      const candidates = await this.prisma.order.findMany({
        where: {
          status: "PENDING",
          paymentExpiresAt: {
            lt: cutoff,
          },
          ...(userId ? { userId } : {}),
        },
        select: { id: true, paymentExpiresAt: true },
      });

      if (candidates.length > 0) {
        console.log(
          `[checkExpiredOrders] Cancelling ${
            candidates.length
          } orders: ${candidates
            .map((c) => `${c.id} (Exp: ${c.paymentExpiresAt})`)
            .join(", ")}`
        );

        await this.prisma.order.updateMany({
          where: {
            id: { in: candidates.map((c) => c.id) },
            status: "PENDING", // Double check status
          },
          data: {
            status: "CANCELLED",
          },
        });
      }
    } catch (error) {
      // Ignore errors during background update to not block the main request
      console.error("Failed to update expired orders:", error);
    }
  }

  async findAll() {
    await this.checkExpiredOrders();
    return await this.prisma.order.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        orderItems: {
          include: {
            product: true,
          },
        },
        ratings: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByUserId(userId: string) {
    await this.checkExpiredOrders(userId);
    return await this.prisma.order.findMany({
      where: { userId },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        ratings: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findOne(id: string, userId: string, role: string) {
    // Ensure this specific order is updated if expired
    const skewMs = Number(process.env.EXPIRY_SKEW_MS || "120000");
    const cutoff = new Date(Date.now() - skewMs);
    await this.prisma.order.updateMany({
      where: {
        id,
        status: "PENDING",
        paymentExpiresAt: { lt: cutoff },
      },
      data: { status: "CANCELLED" },
    });

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        orderItems: {
          include: {
            product: true,
          },
        },
        ratings: true,
      },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    // Check authorization - users can only see their own orders
    if (role !== "ADMIN" && order.userId !== userId) {
      throw new Error("Unauthorized to view this order");
    }

    return order;
  }

  async create(data: CreateOrderDto) {
    // Validate user exists
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Opsional: izinkan order meski stok kurang, dikendalikan via ENV
    const allowOutOfStock = process.env.ORDER_ALLOW_OUT_OF_STOCK === "true";

    // Validate products exist and calculate total; kumpulkan availability
    let totalAmount = 0;
    const availabilities: string[] = [];

    for (const item of data.orderItems) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (!product) {
        throw new Error(`Product with ID ${item.productId} not found`);
      }

      // Check stock strictly if not allowed to be out of stock
      // Also ensure product.stock is not already negative
      if (!allowOutOfStock) {
        if (product.stock <= 0) {
          throw new HttpError(
            400,
            `Stok produk "${product.name}" habis. Silakan hapus dari keranjang.`
          );
        }
        if (product.stock < item.quantity) {
          throw new HttpError(
            400,
            `Stok tidak cukup untuk produk "${product.name}". Tersedia: ${product.stock}, Diminta: ${item.quantity}`
          );
        }
      }

      totalAmount += product.price * item.quantity;
      availabilities.push(
        String((product as any)?.availability || "READY").toUpperCase()
      );
    }

    // Apply Discount if provided
    let discountCode = "";
    if (
      data.discountCode &&
      typeof data.discountCode === "string" &&
      data.discountCode.trim().length > 0
    ) {
      try {
        discountCode = data.discountCode.trim();
        const discountService = new DiscountService(this.prisma);

        // Ensure discount service is initialized
        if (!discountService) {
          throw new Error("Failed to initialize DiscountService");
        }

        const validation = await discountService.validateUsage(
          discountCode,
          data.userId,
          totalAmount
        );

        if (!validation.valid) {
          throw new HttpError(
            400,
            `Kode diskon tidak valid: ${validation.reason}`
          );
        }

        const discount = await discountService.findByCode(discountCode);
        if (discount) {
          let discountVal = 0;
          if (discount.type === "PERCENTAGE") {
            discountVal = (totalAmount * Number(discount.value)) / 100;
          } else {
            discountVal = Number(discount.value);
          }
          totalAmount = Math.max(0, totalAmount - discountVal);
        }
      } catch (error: any) {
        console.error("Discount validation error:", error);
        if (error instanceof HttpError) {
          throw error;
        }
        // Throw detailed error to help debugging
        throw new HttpError(
          500,
          `Kesalahan validasi diskon: ${error.message || "Unknown error"}`
        );
      }
    }

    // Normalize optional pickupAt: convert string -> Date
    let pickupAtDate: Date | undefined;
    if (
      typeof (data as any).pickupAt === "string" &&
      (data as any).pickupAt.trim().length
    ) {
      const d = new Date((data as any).pickupAt);
      if (!isNaN(d.getTime())) {
        pickupAtDate = d;
      }
    }

    // Hitung minPickupAt dan paymentExpiresAt
    const now = new Date();
    const minPickupAt = calculateMinPickupAt(now, availabilities as any);
    // Set payment expiry to 1 hour (was 24 hours) as per user request
    const paymentExpiresAt = new Date(now.getTime() + 1 * 60 * 60 * 1000);

    // Validasi pickupAt bila ada
    if (pickupAtDate) {
      // Harus >= minPickupAt
      if (pickupAtDate.getTime() < minPickupAt.getTime()) {
        throw new HttpError(
          422,
          "pickupAt lebih cepat dari minimum yang diizinkan"
        );
      }
      // Harus dalam jam operasional Asia/Jakarta
      const { open, close } = getPickupConfig();
      const hhmmJakarta = toJakartaHHmm(pickupAtDate);
      // Pastikan urutan parameter: open, close, candidate
      if (!isWithinOperatingHours(open, close, hhmmJakarta)) {
        throw new HttpError(422, "pickupAt di luar jam operasional toko");
      }
    }

    // Create order with order items
    const order = await this.prisma.order.create({
      data: {
        userId: data.userId,
        totalAmount,
        status: data.status || "PENDING",
        shippingAddress: data.shippingAddress,
        paymentMethod: data.paymentMethod,
        paymentMethodCode: data.paymentMethodCode,
        minPickupAt,
        paymentExpiresAt,
        // simpan pickupAt jika valid
        ...(pickupAtDate ? { pickupAt: pickupAtDate } : {}),
        orderItems: {
          create: data.orderItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      } as any,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Record discount usage if applied
    if (discountCode) {
      try {
        const discountService = new DiscountService(this.prisma);
        await discountService.recordUsage(discountCode, data.userId, order.id);
      } catch (error: any) {
        // Rollback order if discount recording fails
        console.error(
          "Failed to record discount usage, rolling back order:",
          error
        );
        // Manual cascade delete for rollback because schema might not have onDelete: Cascade
        try {
          await this.prisma.orderItem.deleteMany({
            where: { orderId: order.id },
          });
          await this.prisma.order.delete({ where: { id: order.id } });
        } catch (rollbackError) {
          console.error("Rollback failed:", rollbackError);
        }

        // Jika error P2002 (unik), berarti sudah digunakan untuk order ini (seharusnya tidak terjadi karena order baru)
        // atau race condition.
        if (error.code === "P2002") {
          throw new HttpError(
            400,
            "Kode diskon sudah digunakan untuk pesanan ini"
          );
        }
        throw new HttpError(
          400,
          error.message || "Gagal menerapkan kode diskon"
        );
      }
    }

    // Hitung pickupReadyAt berdasarkan availability produk (legacy)
    try {
      const nowLegacy = new Date();
      const addDays = (date: Date, days: number) =>
        new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
      let maxReady: Date | undefined = undefined;
      for (const oi of (order as any).orderItems) {
        const av = String(
          (oi as any)?.product?.availability || "READY"
        ).toUpperCase();
        const days = av === "PO_5_DAY" ? 5 : av === "PO_2_DAY" ? 2 : 0;
        const candidate = addDays(nowLegacy, days);
        if (!maxReady || candidate.getTime() > maxReady.getTime()) {
          maxReady = candidate;
        }
      }
      if (maxReady) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { pickupReadyAt: maxReady } as any,
        });
        (order as any).pickupReadyAt = maxReady;
      }
    } catch (e) {
      // jangan blokir order bila perhitungan gagal
      console.warn("Failed to compute pickupReadyAt:", e);
    }

    // Update product stock hanya jika stock check aktif
    // NOTE: Stock decrement moved to payment success handler (Tripay Callback / Manual Pay)
    /*
    if (!allowOutOfStock) {
      for (const item of data.orderItems) {
        await this.prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }
    }
    */

    return order;
  }

  async update(id: string, data: UpdateOrderDto, userId: string, role: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      // Pilih field yang diperlukan agar tipe Prisma mencakup paidAt
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!existing) {
      throw new Error("Order not found");
    }

    // Check authorization
    if (role !== "ADMIN" && existing.userId !== userId) {
      throw new Error("Unauthorized to update this order");
    }

    // Only admin can change status to certain values
    if (data.status && role !== "ADMIN") {
      const allowedStatuses = ["CANCELLED"];
      if (!allowedStatuses.includes(data.status)) {
        throw new Error("Unauthorized to change order status");
      }
    }

    // Admin: validate status transition flow
    if (data.status && role === "ADMIN") {
      const current = String(existing.status).toUpperCase();
      const next = String(data.status).toUpperCase();

      // Opsi konfigurasi: izinkan admin langsung menandai PENDING -> COMPLETED
      const allowPendingToCompletedEnv = String(
        process.env.ORDER_ALLOW_PENDING_TO_COMPLETED || "false"
      ).toLowerCase();
      const allowPendingToCompleted = ["1", "true", "yes", "y"].includes(
        allowPendingToCompletedEnv
      );

      const transitions: Record<string, string[]> = {
        PENDING: ["PROCESSING", "CANCELLED"],
        PROCESSING: ["READY_FOR_PICKUP", "COMPLETED", "CANCELLED"],
        READY_FOR_PICKUP: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
      };

      if (allowPendingToCompleted) {
        transitions.PENDING = [...transitions.PENDING, "COMPLETED"];
      }
      const allowedNext = transitions[current] || [];
      if (current !== next && !allowedNext.includes(next)) {
        throw new Error(`Invalid status transition: ${current} -> ${next}`);
      }
    }

    // Admin or pemilik pesanan boleh set/mengubah pickupAt
    // Tolak hanya jika bukan admin dan bukan pemilik
    if (
      typeof data.pickupAt !== "undefined" &&
      role !== "ADMIN" &&
      existing.userId !== userId
    ) {
      throw new Error("Unauthorized to set pickup schedule");
    }

    // If order is cancelled, restore product stock (only if it was paid/processed/deducted)
    // PENDING orders haven't deducted stock yet in new flow
    if (
      data.status === "CANCELLED" &&
      existing.status !== "CANCELLED" &&
      existing.status !== "PENDING"
    ) {
      const orderItems = await this.prisma.orderItem.findMany({
        where: { orderId: id },
      });

      for (const item of orderItems) {
        await this.prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
            sold: { decrement: item.quantity },
          },
        });
      }
    }

    // If order is marked as PAID/PROCESSING/COMPLETED from PENDING (e.g. by Admin), decrement stock
    // Check robust status groups
    const isDeducted = (s: string) =>
      [
        "PROCESSING",
        "READY_FOR_PICKUP",
        "COMPLETED",
        "PICKED_UP",
        "PAID",
        "SUCCESS",
      ].includes(String(s).toUpperCase());
    const isNotDeducted = (s: string) =>
      ["PENDING", "UNPAID", "NEW"].includes(String(s).toUpperCase());

    if (
      data.status &&
      isDeducted(data.status) &&
      isNotDeducted(existing.status)
    ) {
      const orderItems = await this.prisma.orderItem.findMany({
        where: { orderId: id },
      });

      for (const item of orderItems) {
        await this.prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity },
            sold: { increment: item.quantity },
          },
        });
      }
    }

    // Normalize payload: convert pickupAt string -> Date
    const updateData: any = { ...data };
    if (typeof data.pickupAt === "string" && data.pickupAt.trim().length) {
      const d = new Date(data.pickupAt);
      if (!isNaN(d.getTime())) {
        updateData.pickupAt = d;
      } else {
        // ignore invalid date string
        delete updateData.pickupAt;
      }
    }

    // Auto set paidAt when marking as COMPLETED
    // Tidak bergantung pada existing.paidAt untuk menghindari error tipe
    if (data.status === "COMPLETED" || data.status === "PROCESSING") {
      if (data.status === "COMPLETED" && !updateData.paidAt) {
        updateData.paidAt = new Date();
      }
      // Invalidate recommendations cache to update "Popular Products" immediately
      invalidatePrefix("recs:v2:");
    }

    // No longer populating pickedUpAt/pickedUpById for new operations

    return await this.prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: true,
      },
    });

    if (!existing) {
      throw new Error("Order not found");
    }

    // If order is not cancelled and not PENDING, restore stock before deletion
    if (existing.status !== "CANCELLED" && existing.status !== "PENDING") {
      for (const item of existing.orderItems) {
        await this.prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
            sold: { decrement: item.quantity },
          },
        });
      }
    }

    // Delete order items first (cascade might handle this, but explicit is better)
    await this.prisma.orderItem.deleteMany({
      where: { orderId: id },
    });

    // Delete order
    return await this.prisma.order.delete({
      where: { id },
    });
  }
}
