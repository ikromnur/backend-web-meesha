export interface Message {
  id: number;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  isRead: boolean;
  createdAt: string; // ISO string
  // Optional URL foto profil pengirim (jika ada user dengan email yang sama)
  senderPhotoUrl?: string | null;
}

export interface MessageReply {
  id: number;
  messageId: number;
  replyText: string;
  adminName?: string | null;
  adminEmail?: string | null;
  createdAt: string; // ISO string
}

export interface MessageListResponseMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface MessageListResponse {
  data: Message[];
  meta: MessageListResponseMeta;
}

export interface MessageDetailResponse {
  data: Message & { replies: MessageReply[] };
}

export interface MessageReplyCreatePayload {
  messageId: number;
  replyText: string;
  adminName?: string;
  adminEmail?: string;
}
