import crypto from "crypto";

export const buildSignature = (
  privateKey: string,
  merchantCode: string,
  merchantRef: string,
  amount: number,
) => {
  const payload = `${merchantCode}${merchantRef}${amount}`;
  return crypto.createHmac("sha256", privateKey).update(payload).digest("hex");
};

export const resolveTripayBaseUrl = () => {
  // Ikuti dokumentasi Tripay: domain resmi 'https://tripay.co.id'
  // Sandbox: https://tripay.co.id/api-sandbox
  // Production: https://tripay.co.id/api
  const mode = String(process.env.TRIPAY_MODE || "sandbox").toLowerCase();
  const baseDomain = "https://tripay.co.id";
  const seg = mode === "sandbox" ? "api-sandbox" : "api";
  const computed = `${baseDomain}/${seg}`;
  const override = process.env.TRIPAY_BASE_URL && process.env.TRIPAY_BASE_URL.trim();
  const url = override || computed;
  return url.replace(/\/$/, "");
};

export const pickAllowedChannels = (channels: any[]) => {
  // Bisa dikonfigurasi via ENV TRIPAY_ALLOWED_CODES (comma-separated)
  const envCodes = (process.env.TRIPAY_ALLOWED_CODES || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const fallback = ["BNIVA", "BRIVA", "MANDIRIVA", "BCAVA", "QRIS"];
  const allow = new Set(envCodes.length ? envCodes : fallback);
  return Array.isArray(channels)
    ? channels.filter((c) => allow.has(String(c.code || c.channel_code || c.method).toUpperCase()))
    : [];
};

export default {
  buildSignature,
  resolveTripayBaseUrl,
  pickAllowedChannels,
};