import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";

const router = Router();

function parseDateRange(dateStr?: string) {
  const today = new Date();
  const date = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(date);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

router.get("/stats", authenticate, authorizeAdmin, async (req: Request, res: Response) => {
  try {
    const dateStr = typeof req.query.date === "string" ? req.query.date : undefined;
    const { start, end } = parseDateRange(dateStr);

    const completedOrders = await prisma.order.findMany({
      where: {
        status: "COMPLETED",
        createdAt: { gte: start, lte: end },
      },
      include: {
        orderItems: true,
      },
    });

    const productsSold = completedOrders.reduce((sum, o) => sum + o.orderItems.reduce((s, i) => s + i.quantity, 0), 0);
    const totalProfit = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const newCustomers = await prisma.user.count({
      where: {
        createdAt: { gte: start, lte: end },
      },
    });

    return res.status(200).json({
      data: {
        productsSold,
        totalProfit,
        newCustomers,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err?.message || "Server error" } });
  }
});

export default router;