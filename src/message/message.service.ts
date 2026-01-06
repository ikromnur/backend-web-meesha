import {
  countMessages,
  findMessages,
  findMessageById,
  createMessage,
  createReply,
  updateMessageRead,
} from "./message.repository";
import { findUserByEmail, findUsersByEmails } from "../user/user.repository";

export const getMessagesService = async (params: {
  q?: string;
  read?: "0" | "1" | undefined;
  page?: number;
  pageSize?: number;
}) => {
  const where: any = {};
  if (params.q && params.q.trim() !== "") {
    const q = params.q.trim();
    where.OR = [
      { senderName: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { body: { contains: q, mode: "insensitive" } },
    ];
  }
  if (params.read === "0" || params.read === "1") {
    where.isRead = params.read === "1";
  }
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize =
    params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const [total, data] = await Promise.all([
    countMessages(where),
    findMessages(where, skip, take),
  ]);

  // Transform data for frontend
  const hydrated = data.map((m: any) => {
    const senderName = m.senderName || m.senderEmail || "Unknown";
    return {
      ...m,
      senderPhotoUrl: m.user?.photo_profile ?? null,
      // Frontend compatibility fields (DashboardMessage type)
      sender: senderName,
      initials: senderName
        .split(" ")
        .map((n: string) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
      avatarUrl: m.user?.photo_profile ?? null,
      title: m.subject,
      content: m.body,
      date: new Date(m.createdAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      read: m.isRead,
    };
  });

  return { data: hydrated, meta: { page, pageSize, total } };
};

export const getMessageDetailService = async (id: number) => {
  const message = await findMessageById(id);
  if (!message) throw new Error("Message not found");

  return {
    ...message,
    senderPhotoUrl: message.user?.photo_profile ?? null,
  };
};

export const createMessageService = async (payload: {
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  phone?: string;
  userId?: string;
}) => {
  return await createMessage(payload);
};

export const replyMessageService = async (payload: {
  messageId: number;
  replyText: string;
  adminName?: string;
  adminEmail?: string;
}) => {
  return await createReply(payload);
};

export const markReadService = async (id: number, isRead: boolean) => {
  return await updateMessageRead(id, isRead);
};

export default {
  getMessagesService,
  getMessageDetailService,
  createMessageService,
  replyMessageService,
  markReadService,
};
