import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";

const router = Router();

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
       const now = new Date();
       dateStr = now.toISOString().split("T")[0];
    }
    // Bangun rentang berdasarkan Asia/Jakarta (+07:00)
    const start = new Date(`${dateStr}T00:00:00+07:00`);
    const end = new Date(`${dateStr}T23:59:59.999+07:00`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      // Fallback ke UTC
      const s = new Date(`${dateStr}T00:00:00Z`);
      const e = new Date(`${dateStr}T23:59:59.999Z`);
      return { start: s, end: e };
    }
    return { start, end };
  } catch (error) {
    console.error("Error parsing date range:", error);
    const now = new Date();
    const s = new Date(now.setHours(0,0,0,0));
    const e = new Date(now.setHours(23,59,59,999));
    return { start: s, end: e };
  }
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
