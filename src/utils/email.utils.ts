import axios from "axios";
import dotenv from "dotenv";
import path from "path";

// Ensure env vars are loaded (and reloaded if changed)
dotenv.config();

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";

// Robust parsing for EMAIL_FROM that may be in format: "Name <email@domain>"
export const resolveSender = () => {
  // Reload env vars to ensure we have the latest values
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

  const rawFrom =
    process.env.BREVO_SENDER_EMAIL ||
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    "";
  let email = (rawFrom || "").trim();
  let name =
    process.env.BREVO_SENDER_NAME || process.env.EMAIL_FROM_NAME || "Meesha";

  // If rawFrom is in "Name <email@domain>" format, extract parts
  const angleMatch = rawFrom.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  if (angleMatch) {
    const possibleName = angleMatch[1]?.trim();
    email = angleMatch[2]?.trim();
    if (
      !process.env.BREVO_SENDER_NAME &&
      !process.env.EMAIL_FROM_NAME &&
      possibleName
    ) {
      // Use name from EMAIL_FROM when explicit sender name envs are not set
      name = possibleName.replace(/^"|"$/g, "");
    }
  } else {
    // If email is wrapped in quotes, strip them
    email = email.replace(/^"|"$/g, "");
  }

  return { email, name };
};

const formatAxiosError = (error: any) => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const msg = error?.message || String(error);
  return status
    ? `${msg} | status=${status} | data=${JSON.stringify(data)}`
    : msg;
};

const brevoSend = async (
  toEmail: string,
  subject: string,
  htmlContent: string,
  tags?: string[],
  attachments?: { name: string; contentBase64: string }[]
) => {
  // Always read fresh from env to support hot-reloading of .env
  // Force reload .env to pick up changes without server restart
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
  const apiKey = process.env.BREVO_API_KEY || "";

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is missing in environment variables");
  }

  const { email: SENDER_EMAIL, name: SENDER_NAME } = resolveSender();
  if (!SENDER_EMAIL) {
    throw new Error(
      "BREVO_SENDER_EMAIL (or EMAIL_FROM/EMAIL_USER) is required"
    );
  }
  // Prevent using Brevo SMTP login as sender; must be a verified sender
  if (SENDER_EMAIL.includes("smtp-brevo.com")) {
    throw new Error(
      "BREVO_SENDER_EMAIL tidak boleh berupa SMTP login (smtp-brevo.com). Tambahkan & verifikasi alamat pengirim di Brevo, lalu pakai alamat itu."
    );
  }

  const url = "https://api.brevo.com/v3/smtp/email";
  const payload: any = {
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: toEmail }],
    subject,
    htmlContent,
    ...(tags && tags.length ? { tags } : {}),
  };
  // Brevo API expects the field name to be "attachment" (singular)
  // with Base64 content and filename. Type is optional and inferred.
  if (attachments && attachments.length) {
    payload.attachment = attachments.map((a) => ({
      name: a.name,
      content: a.contentBase64,
    }));
  }

  const headers = {
    "api-key": apiKey,
    "Content-Type": "application/json",
  };

  try {
    const attachmentsCount = Array.isArray(payload.attachment)
      ? payload.attachment.length
      : 0;
    const attachmentNames = attachmentsCount
      ? payload.attachment.map((a: any) => a.name)
      : [];
    console.log(
      `[Brevo] Sending email: from="${SENDER_NAME} <${SENDER_EMAIL}>" to=${toEmail} subject="${subject}" tags=${JSON.stringify(
        tags || []
      )} atts=${attachmentsCount} (${attachmentNames})`
    );

    const response = await axios.post(url, payload, { headers });
    return response.data;
  } catch (error: any) {
    console.error(`[Brevo] Send Error: ${formatAxiosError(error)}`);
    // Re-throw so caller knows it failed
    throw error;
  }
};

export default {
  async sendInvoiceEmail(params: {
    toEmail: string;
    orderId: string;
    amount: number;
    paymentMethod: string;
    paymentMethodCode?: string;
    items: { name: string; quantity: number; price: number }[];
    orderUrl: string;
    attachments?: { name: string; contentBase64: string }[];
  }) {
    const {
      toEmail,
      orderId,
      amount,
      paymentMethod,
      items,
      orderUrl,
      attachments,
    } = params;
    const subject = `Invoice Pembayaran Order #${orderId}`;
    const itemsHtml = items
      .map(
        (item) =>
          `<li>${item.name} x${item.quantity} @ Rp${item.price.toLocaleString(
            "id-ID"
          )}</li>`
      )
      .join("");

    const html = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Terima Kasih atas Pesanan Anda</h2>
        <p>Order <strong>#${orderId}</strong> telah berhasil dibayar.</p>
        <p>Total: <strong>Rp${amount.toLocaleString("id-ID")}</strong></p>
        <p>Metode Pembayaran: ${paymentMethod}</p>
        <h3>Rincian Barang:</h3>
        <ul>${itemsHtml}</ul>
        <p>
          <a href="${orderUrl}" style="background-color: #007bff; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px;">Lihat Pesanan</a>
        </p>
      </div>
    `;

    return brevoSend(toEmail, subject, html, ["invoice"], attachments);
  },

  async sendVerificationOtp(toEmail: string, otp: string, ttlMinutes = 10) {
    const subject = "Verifikasi Akun - Kode OTP";
    const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2>Verifikasi Akun Meesha</h2>
      <p>Halo,</p>
      <p>Gunakan Kode OTP berikut untuk memverifikasi akun Anda. Kode ini berlaku selama ${ttlMinutes} menit.</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #000;">${otp}</p>
      <p>Jika Anda tidak merasa melakukan pendaftaran, abaikan email ini.</p>
      <p>Terima kasih,<br/>Tim Meesha</p>
    </div>
  `;
    try {
      await brevoSend(toEmail, subject, html, ["otp-register"]);
      console.log(`Verification OTP sent to ${toEmail}`);
    } catch (error) {
      console.error(
        `Error sending verification email to ${toEmail}: ${formatAxiosError(
          error
        )}`
      );
      throw new Error("Could not send verification email.");
    }
  },

  async sendPasswordResetOtp(toEmail: string, otp: string, ttlMinutes = 10) {
    const subject = "Password Reset OTP";
    const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2>Reset Password Meesha</h2>
      <p>Halo,</p>
      <p>Gunakan Kode OTP berikut untuk mereset password Anda. Kode ini berlaku selama ${ttlMinutes} minutes.</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #000;">${otp}</p>
      <p>Jika Anda tidak meminta reset password, abaikan email ini.</p>
      <p>Terima kasih,<br/>Tim Meesha</p>
    </div>
  `;
    try {
      await brevoSend(toEmail, subject, html, ["otp-reset-password"]);
      console.log(`Password reset OTP sent to ${toEmail}`);
    } catch (error) {
      console.error(
        `Error sending password reset email to ${toEmail}: ${formatAxiosError(
          error
        )}`
      );
      throw new Error("Could not send password reset email.");
    }
  },

  async sendPickupReminderEmail(
    toEmail: string,
    orderId: string,
    customerName: string,
    pickupTime: Date,
    type: "H-1" | "H-1h"
  ) {
    const subject = `Reminder: Penjemputan Pesanan #${orderId} - ${
      type === "H-1" ? "Besok" : "1 Jam Lagi"
    }`;

    const dt = new Date(pickupTime);
    const dateStr = dt.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Jakarta",
    });
    // Format time as HH.mm (e.g. 18.40)
    const timeStr = dt
      .toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Jakarta",
      })
      .replace(":", ".");

    const timeString = `${dateStr} pukul ${timeStr}`;

    let html = "";

    if (type === "H-1h") {
      html = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2 style="font-size: 20px;">Halo ${customerName},</h2>
        <p>Ini adalah pengingat untuk pesanan Anda <strong>#${orderId}</strong>.</p>
        <p>Jadwal penjemputan Anda adalah:</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e9ecef;">
          <h3 style="margin: 0; color: #2c3e50; font-size: 18px;">${timeString}</h3>
        </div>
        <p>Lokasi Meesha Florist Kebumen bisa dicari di maps atau klik link berikut: 
           <a href="https://share.google/c1Ox2YOPDR0DjDNqJ" style="color: #007bff; text-decoration: none;">https://share.google/c1Ox2YOPDR0DjDNqJ</a>
        </p>
        <p>Mohon pastikan Anda datang tepat waktu. Jika ada perubahan, silakan hubungi kami segera.</p>
        <br/>
        <p>Terima kasih,<br/>Tim Meesha</p>
      </div>
    `;
    } else {
      // Default H-1 template
      html = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Halo ${customerName},</h2>
        <p>Ini adalah pengingat untuk pesanan Anda <strong>#${orderId}</strong>.</p>
        <p>Jadwal penjemputan Anda adalah:</p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <h3 style="margin: 0; color: #333;">${timeString}</h3>
        </div>
        <p>Lokasi Meesha Florist Kebumen bisa dicari di maps atau klik link berikut: 
           <a href="https://share.google/c1Ox2YOPDR0DjDNqJ" style="color: #007bff; text-decoration: none;">https://share.google/c1Ox2YOPDR0DjDNqJ</a>
        </p>
        <p>Mohon pastikan Anda datang tepat waktu. Jika ada perubahan, silakan hubungi kami segera.</p>
        <br/>
        <p>Terima kasih,<br/>Tim Meesha</p>
      </div>
    `;
    }

    return brevoSend(toEmail, subject, html, ["pickup-reminder", type]);
  },

  async sendAdminNotification(subject: string, htmlContent: string) {
    const { email: senderEmail } = resolveSender();
    // Prioritaskan ADMIN_EMAIL jika ada, jika tidak gunakan senderEmail sebagai tujuan (self-notification)
    const adminEmail = process.env.ADMIN_EMAIL || senderEmail;

    try {
      console.log(
        `[Admin Notif] Sending to ${adminEmail} subject="${subject}"`
      );
      await brevoSend(adminEmail, subject, htmlContent, ["admin-notification"]);
      console.log(`Admin notification sent to ${adminEmail}`);
    } catch (error) {
      console.error(
        `Failed to send admin notification: ${formatAxiosError(error)}`
      );
      // Jangan throw error agar flow utama tidak putus
    }
  },
};
