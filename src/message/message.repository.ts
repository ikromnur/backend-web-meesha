import prisma from "../lib/prisma";

export const findMessages = async (where: any, skip: number, take: number) => {
  return await prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          photo_profile: true,
          name: true,
          email: true,
        },
      },
    },
    skip,
    take,
  });
};

export const countMessages = async (where: any) => {
  return await prisma.message.count({ where });
};

export const findMessageById = async (id: number) => {
  return await prisma.message.findUnique({
    where: { id },
    include: {
      replies: true,
      user: {
        select: {
          photo_profile: true,
          name: true,
          email: true,
        },
      },
    },
  });
};

export const createMessage = async (payload: {
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  phone?: string;
  userId?: string;
}) => {
  return await prisma.message.create({
    data: {
      senderName: payload.senderName,
      senderEmail: payload.senderEmail,
      subject: payload.subject,
      body: payload.body,
      phone: payload.phone,
      userId: payload.userId,
    },
    select: {
      id: true,
      senderName: true,
      senderEmail: true,
      subject: true,
      body: true,
      phone: true,
      userId: true,
      isRead: true,
      createdAt: true,
    },
  });
};

export const createReply = async (payload: {
  messageId: number;
  replyText: string;
  adminName?: string | null;
  adminEmail?: string | null;
}) => {
  const [reply] = await prisma.$transaction([
    prisma.messageReply.create({
      data: {
        messageId: payload.messageId,
        replyText: payload.replyText,
        adminName: payload.adminName ?? null,
        adminEmail: payload.adminEmail ?? null,
      },
    }),
    prisma.message.update({
      where: { id: payload.messageId },
      data: { isRead: true },
    }),
  ]);
  return reply;
};

export const updateMessageRead = async (id: number, isRead: boolean) => {
  return await prisma.message.update({
    where: { id },
    data: { isRead },
    select: { id: true, isRead: true },
  });
};
