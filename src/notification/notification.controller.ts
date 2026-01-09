import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { NotificationService } from "./notification.service";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
const notificationService = new NotificationService(prisma);

// GET /api/notifications
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const notifications = await notificationService.findAllByUser(userId);
    res.json({ data: notifications });
  } catch (error) {
    next(error);
  }
});

// GET /api/notifications/unread-count
router.get("/unread-count", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    console.log(`[Notification] getUnreadCount for user ${userId}`);
    const count = await notificationService.getUnreadCount(userId);
    res.json({ data: { count } });
  } catch (error) {
    console.error("[Notification] getUnreadCount error:", error);
    next(error);
  }
});

// PATCH /api/notifications/read-all
router.patch("/read-all", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    await notificationService.markAllAsRead(userId);
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const notification = await notificationService.markAsRead(id, userId);
    res.json({ data: notification });
  } catch (error) {
    next(error);
  }
});

export default router;
