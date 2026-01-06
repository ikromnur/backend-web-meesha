import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";
import { HttpError } from "../utils/http-error";

const router = Router();

// GET all ratings for admin with filtering
router.get(
  "/admin/all",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { filter } = req.query as { filter?: string }; // all, need_reply, replied
      const limit = Math.max(
        1,
        Math.min(50, Number(req.query.limit ?? 10) || 10)
      );
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const skip = (page - 1) * limit;

      let where: any = {};
      if (filter === "need_reply") {
        where.reply = null;
      } else if (filter === "replied") {
        where.reply = { not: null };
      }

      const [rows, total] = await (prisma as any).$transaction([
        (prisma as any).productRating.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
          include: {
            user: { select: { name: true, username: true, email: true } },
            product: { select: { name: true, imageUrl: true } },
          },
        }),
        (prisma as any).productRating.count({ where }),
      ]);

      const data = rows.map((r: any) => {
        // Helper simple untuk ambil URL gambar pertama dari JSON imageUrl
        let firstImg = null;
        if (
          Array.isArray(r.product?.imageUrl) &&
          r.product.imageUrl.length > 0
        ) {
          firstImg = r.product.imageUrl[0]?.url;
        } else if (r.product?.imageUrl?.url) {
          firstImg = r.product.imageUrl.url;
        }

        return {
          id: r.id,
          userId: r.userId,
          productId: r.productId,
          orderId: r.orderId,
          rating: r.rating,
          comment: r.comment ?? null,
          reply: r.reply ?? null,
          replyAt: r.replyAt ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          userName: r.user?.name || r.user?.username || "Anonim",
          userEmail: r.user?.email,
          productName: r.product?.name,
          productImage: firstImg,
        };
      });

      return res.status(200).json({
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ADMIN reply to rating
router.post(
  "/:id/reply",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { reply } = req.body;

      if (!reply || typeof reply !== "string") {
        throw new HttpError(400, "Reply message is required");
      }

      const rating = await (prisma as any).productRating.findUnique({
        where: { id },
      });

      if (!rating) {
        throw new HttpError(404, "Rating not found");
      }

      const updatedRating = await (prisma as any).productRating.update({
        where: { id },
        data: {
          reply,
          replyAt: new Date(),
        },
      });

      return res.status(200).json({ data: updatedRating });
    } catch (error) {
      next(error);
    }
  }
);

// GET ratings list by productId with pagination
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.query as Record<string, string | undefined>;
    if (!productId || typeof productId !== "string") {
      throw new HttpError(400, "productId wajib diisi");
    }

    const limit = Math.max(
      1,
      Math.min(50, Number(req.query.limit ?? 10) || 10)
    );
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const skip = (page - 1) * limit;

    const [rows, total] = await (prisma as any).$transaction([
      (prisma as any).productRating.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        select: {
          id: true,
          userId: true,
          productId: true,
          orderId: true,
          rating: true,
          comment: true,
          reply: true,
          replyAt: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { name: true, username: true } },
        },
      }),
      (prisma as any).productRating.count({ where: { productId } }),
    ]);

    const data = rows.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      productId: r.productId,
      orderId: r.orderId,
      rating: r.rating,
      comment: r.comment ?? null,
      reply: r.reply ?? null,
      replyAt: r.replyAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      userName: r.user?.name || r.user?.username || "Anonim",
    }));

    return res.status(200).json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Log request body for debugging
      console.log("POST /ratings request body:", req.body);
      const userId = (req as any).user?.userId as string | undefined;
      console.log("POST /ratings userId:", userId);

      if (!userId) throw new HttpError(401, "Unauthorized");

      const { productId, orderId, rating, comment } = req.body || {};
      if (!productId || typeof productId !== "string") {
        throw new HttpError(400, "productId wajib diisi");
      }
      const r = Number(rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) {
        throw new HttpError(400, "rating harus integer 1-5");
      }
      if (comment !== undefined && typeof comment !== "string") {
        throw new HttpError(400, "comment harus string");
      }

      // Validate product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new HttpError(404, "Product not found");

      // If orderId provided, ensure it belongs to user and completed
      if (orderId) {
        const order = await prisma.order.findUnique({
          where: { id: String(orderId) },
        });
        if (!order) throw new HttpError(404, "Order not found");
        if (order.userId !== userId)
          throw new HttpError(403, "Order tidak milik pengguna");
        if (order.status !== "COMPLETED")
          throw new HttpError(400, "Order belum COMPLETED");
      }

      // Check if rating already exists
      const existingRating = await (prisma as any).productRating.findFirst({
        where: {
          userId,
          productId,
          orderId: orderId ? String(orderId) : null,
        },
      });

      if (existingRating) {
        throw new HttpError(400, "Ulasan sudah dibuat dan tidak dapat diubah");
      }

      console.log("Creating rating with data:", {
        userId,
        productId,
        orderId: orderId ? String(orderId) : null,
        rating: r,
        comment: comment ?? null,
      });

      const data = await (prisma as any).productRating.create({
        data: {
          userId,
          productId,
          orderId: orderId ? String(orderId) : null,
          rating: r,
          comment: comment ?? null,
        },
        select: {
          id: true,
          userId: true,
          productId: true,
          orderId: true,
          rating: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      console.log("Rating created successfully:", data);
      return res.status(201).json({ data });
    } catch (error) {
      console.error("Error in POST /ratings:", error);
      next(error);
    }
  }
);

export default router;
