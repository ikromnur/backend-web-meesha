import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { DiscountService } from "./discount.service";
import { CreateDiscountDto, UpdateDiscountDto } from "../types/discount";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";
import { z } from "zod";

const router = Router();
const discountService = new DiscountService(prisma);

// Validation schema
const discountTypeSchema = z.enum(["PERCENTAGE", "FIXED_AMOUNT"]);
const discountStatusSchema = z.enum(["ACTIVE", "INACTIVE", "EXPIRED"]);

const isValidDateString = (value: string) => !Number.isNaN(Date.parse(value));

const discountCreateSchema = z
  .object({
    code: z.string().min(1, "Kode diskon wajib diisi"),
    value: z.number().nonnegative("Nilai diskon harus >= 0"),
    type: discountTypeSchema,
    startDate: z.string().refine(isValidDateString, "startDate tidak valid"),
    endDate: z.string().refine(isValidDateString, "endDate tidak valid"),
    status: discountStatusSchema.optional(),
    maxUsage: z.number().int().positive().optional(),
    maxUsagePerUser: z.number().int().positive().optional(),
  })
  .refine((data) => Date.parse(data.startDate) < Date.parse(data.endDate), {
    message: "endDate must be after startDate",
  });

const discountUpdateSchema = z
  .object({
    code: z.string().min(1).optional(),
    value: z.number().nonnegative().optional(),
    type: discountTypeSchema.optional(),
    startDate: z
      .string()
      .refine(isValidDateString, "startDate tidak valid")
      .optional(),
    endDate: z
      .string()
      .refine(isValidDateString, "endDate tidak valid")
      .optional(),
    status: discountStatusSchema.optional(),
    maxUsage: z.number().int().positive().optional(),
    maxUsagePerUser: z.number().int().positive().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return Date.parse(data.startDate) < Date.parse(data.endDate);
      }
      return true;
    },
    { message: "endDate must be after startDate" }
  );

// POST /api/discounts
router.post(
  "/",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = discountCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message:
            parsed.error.issues?.[0]?.message || "Format payload tidak valid",
        });
      }

      const createDiscountDto: CreateDiscountDto = parsed.data;
      const result = await discountService.create(createDiscountDto);
      res.status(201).json({ data: result });
    } catch (error) {
      if ((error as any)?.code === "P2002") {
        return res.status(409).json({ message: "Kode diskon sudah digunakan" });
      }
      next(error);
    }
  }
);

// GET /api/discounts
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await discountService.findAll();
    res.status(200).json({ data: results });
  } catch (error) {
    next(error);
  }
});

// GET /api/discounts/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    try {
      const result = await discountService.findOne(id);
      return res.status(200).json({ data: result });
    } catch (err: any) {
      if (err?.status === 404) {
        const byCode = await discountService.findByCode(id);
        if (byCode) return res.status(200).json({ data: byCode });
        return res
          .status(404)
          .json({ message: `Discount with ID or code '${id}' not found.` });
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

// PATCH /api/discounts/:id
router.patch(
  "/:id",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = discountUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message:
            parsed.error.issues?.[0]?.message || "Format payload tidak valid",
        });
      }
      const updateDiscountDto: UpdateDiscountDto = parsed.data;
      const result = await discountService.update(id, updateDiscountDto);
      res.status(200).json({ data: result });
    } catch (error) {
      if ((error as any)?.code === "P2002") {
        return res.status(409).json({ message: "Kode diskon sudah digunakan" });
      }
      next(error);
    }
  }
);

// DELETE /api/discounts/:id
router.delete(
  "/:id",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await discountService.remove(id);
      res.status(200).json({ message: "Discount deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/discounts/validate
router.post(
  "/validate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code =
        typeof req.body?.code === "string" ? req.body.code : undefined;
      const orderAmount =
        typeof req.body?.orderAmount === "number"
          ? req.body.orderAmount
          : undefined;
      const userId =
        typeof req.body?.userId === "string" ? req.body.userId : undefined;
      
      if (!code) return res.status(400).json({ message: "code wajib diisi" });
      if (typeof orderAmount !== "number" || orderAmount < 0)
        return res.status(400).json({ message: "orderAmount tidak valid" });

      const validation = await discountService.validateUsage(code, userId, orderAmount);
      if (!validation.valid) {
        return res.status(200).json(validation);
      }

      const discount = await discountService.findByCode(code);
      if (!discount) return res.status(404).json({ valid: false, reason: "NOT_FOUND" });

      const amountOff =
        discount.type === "PERCENTAGE"
          ? Math.floor((Number(discount.value) / 100) * orderAmount)
          : Math.floor(Number(discount.value));
      const finalAmount = Math.max(0, Math.floor(orderAmount - amountOff));
      
      return res.status(200).json({
        valid: true,
        discount: {
          id: discount.id,
          code: discount.code,
          type: discount.type,
          value: Number(discount.value),
          expiresAt: discount.endDate,
        },
        computed: { amountOff, finalAmount },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/discounts/redeem
router.post(
  "/redeem",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code =
        typeof req.body?.code === "string" ? req.body.code : undefined;
      const orderId =
        typeof req.body?.orderId === "string" ? req.body.orderId : undefined;
      const userId = req.user?.userId;
      
      if (!code || !orderId)
        return res
          .status(400)
          .json({ message: "Body harus berisi { code, orderId }" });

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true },
      });
      if (!order)
        return res.status(404).json({ message: "Order tidak ditemukan" });
      if (order.userId !== userId)
        return res.status(403).json({ message: "Unauthorized" });

      // Re-validate before redeeming
      const validation = await discountService.validateUsage(code, userId);
      if (!validation.valid) {
        return res.status(409).json({ message: `Discount invalid: ${validation.reason}` });
      }

      try {
        await discountService.recordUsage(code, userId, orderId);
        return res.status(200).json({ success: true });
      } catch (e: any) {
        if (e?.code === "P2002") {
          return res
            .status(200)
            .json({ success: true, message: "Redeem idempotent" });
        }
        throw e;
      }
    } catch (error) {
      next(error);
    }
  }
);

export default router;
