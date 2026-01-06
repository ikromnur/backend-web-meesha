import express from "express";
import { Request, Response } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { z, ZodError } from "zod";
import messageService from "./message.service";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";
import { NotificationService } from "../notification/notification.service";

const router = express.Router();
const notificationService = new NotificationService(prisma);

// GET /api/messages - list with search/filter/pagination (private)
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const { q, read, page, pageSize } = req.query;
    const result = await messageService.getMessagesService({
      q: typeof q === "string" ? q : undefined,
      read:
        typeof read === "string"
          ? read === "0" || read === "1"
            ? read
            : undefined
          : undefined,
      page: typeof page === "string" ? Number(page) : undefined,
      pageSize: typeof pageSize === "string" ? Number(pageSize) : undefined,
    });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

// POST /api/messages - create message from contact form
router.post("/", async (req: Request, res: Response) => {
  // Mendukung dua bentuk payload: (senderName/senderEmail/subject/body) atau (name/email/phone/message)
  const v1Schema = z.object({
    senderName: z.string().min(1),
    senderEmail: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
    phone: z.string().optional(),
  });
  const v2Schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    message: z.string().min(1),
  });

  try {
    let normalized: {
      senderName: string;
      senderEmail: string;
      subject: string;
      body: string;
      phone?: string;
      userId?: string;
    };

    // Try to extract user from token if present (optional auth)
    let userId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        if (process.env.JWT_SECRET) {
          const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
          if (decoded && decoded.userId) {
            userId = decoded.userId;
          }
        }
      } catch (e) {
        // ignore invalid token for public endpoint
      }
    }

    const v1 = v1Schema.safeParse(req.body);
    if (v1.success) {
      normalized = {
        ...v1.data,
        userId,
      };
    } else {
      const v2 = v2Schema.parse(req.body); // akan throw jika invalid
      normalized = {
        senderName: v2.name,
        senderEmail: v2.email,
        subject: "Kontak dari Website",
        body: v2.message,
        phone: v2.phone,
        userId,
      };
    }

    const created = await messageService.createMessageService(normalized);

    // Notify all admins
    try {
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });

      await Promise.all(
        admins.map((admin) =>
          notificationService.create({
            userId: admin.id,
            title: "Pesan Baru Masuk",
            message: `Pesan baru dari ${normalized.senderName}: ${normalized.subject}`,
            type: "INFO",
            link: "/dashboard/messages",
          })
        )
      );
    } catch (error) {
      console.error("Failed to create notifications for new message:", error);
      // Continue execution, do not fail the request
    }

    res.status(201).json({ data: created });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: { message: error.issues?.[0]?.message || "Invalid payload" },
      });
    }
    res.status(500).json({ error: { message: error.message } });
  }
});

// GET /api/messages/:id - detail with replies (private)
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    if (isNaN(idNum)) {
      return res.status(400).json({ error: { message: "Invalid id" } });
    }
    const data = await messageService.getMessageDetailService(idNum);
    res.status(200).json({ data });
  } catch (error: any) {
    const status = error.message === "Message not found" ? 404 : 500;
    res.status(status).json({ error: { message: error.message } });
  }
});

// POST /api/messages/reply (private)
router.post("/reply", authenticate, async (req: Request, res: Response) => {
  const schema = z.object({
    messageId: z.number(),
    replyText: z.string().min(3).max(5000),
    adminName: z.string().optional(),
    adminEmail: z.string().email().optional(),
  });
  try {
    const payload = schema.parse(req.body);
    // ensure message exists
    await messageService.getMessageDetailService(payload.messageId);
    const created = await messageService.replyMessageService(payload);
    res.status(201).json({ data: created });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: { message: error.issues?.[0]?.message || "Invalid payload" },
      });
    }
    const status = error.message === "Message not found" ? 404 : 500;
    res.status(status).json({ error: { message: error.message } });
  }
});

// PATCH /api/messages/:id/read (private)
router.patch("/:id/read", authenticate, async (req: Request, res: Response) => {
  const schema = z.object({ isRead: z.boolean() });
  try {
    const idNum = Number(req.params.id);
    if (isNaN(idNum)) {
      return res.status(400).json({ error: { message: "Invalid id" } });
    }
    const { isRead } = schema.parse(req.body);
    const data = await messageService.markReadService(idNum, isRead);
    res.status(200).json({ data });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: { message: error.issues?.[0]?.message || "Invalid payload" },
      });
    }
    res.status(500).json({ error: { message: error.message } });
  }
});

export default router;
