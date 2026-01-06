// Utilities for Asia/Jakarta timezone handling without external deps
// Assumptions: Asia/Jakarta is UTC+7 with no DST

const JAKARTA_OFFSET_HOURS = 7;

function parseTimeHHmm(value: string): { h: number; m: number } {
  const [hStr, mStr] = String(value || "").split(":");
  const h = parseInt(hStr || "0", 10);
  const m = parseInt(mStr || "0", 10);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

export function toUtcFromJakarta(dateStr: string, timeStr: string): Date {
  // dateStr: YYYY-MM-DD, timeStr: HH:mm (jakarta local)
  const [yStr, moStr, dStr] = String(dateStr || "").split("-");
  const y = parseInt(yStr || "0", 10);
  const mo = parseInt(moStr || "0", 10);
  const d = parseInt(dStr || "0", 10);
  const { h, m } = parseTimeHHmm(timeStr || "00:00");
  // Jakarta is UTC+7 => UTC = local - 7 hours
  const utc = new Date(
    Date.UTC(y, (mo || 1) - 1, d, h - JAKARTA_OFFSET_HOURS, m, 0, 0)
  );
  return utc;
}

export function toJakartaHHmm(date: Date): string {
  const utcMs = date.getTime();
  const jakartaMs = utcMs + JAKARTA_OFFSET_HOURS * 3600_000;
  const jakarta = new Date(jakartaMs);
  const hh = String(jakarta.getUTCHours()).padStart(2, "0");
  const mm = String(jakarta.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d;
}

export function jakartaNowParts(): {
  y: number;
  mo: number;
  d: number;
  h: number;
  m: number;
} {
  const now = new Date();
  // Get current date/time in Asia/Jakarta via fixed offset
  const nowUtcMs = now.getTime();
  const jakartaMs = nowUtcMs + JAKARTA_OFFSET_HOURS * 3600_000;
  const jakarta = new Date(jakartaMs);
  return {
    y: jakarta.getUTCFullYear(),
    mo: jakarta.getUTCMonth() + 1,
    d: jakarta.getUTCDate(),
    h: jakarta.getUTCHours(),
    m: jakarta.getUTCMinutes(),
  };
}

export function isWithinOperatingHours(
  startHHmm: string,
  endHHmm: string,
  candidateHHmm: string
): boolean {
  const open = parseTimeHHmm(startHHmm);
  const close = parseTimeHHmm(endHHmm);
  const cand = parseTimeHHmm(candidateHHmm);
  const openMin = open.h * 60 + open.m;
  const closeMin = close.h * 60 + close.m;
  const candMin = cand.h * 60 + cand.m;
  return candMin >= openMin && candMin < closeMin;
}

export function computeSlotEndHHmm(
  startHHmm: string,
  slotMinutes: number
): string {
  const { h, m } = parseTimeHHmm(startHHmm);
  const total = h * 60 + m + (Number.isFinite(slotMinutes) ? slotMinutes : 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function sameDayBufferSatisfied(
  dateStr: string,
  startHHmm: string,
  bufferMinutes: number
): boolean {
  const parts = jakartaNowParts();
  const todayStr = `${parts.y}-${String(parts.mo).padStart(2, "0")}-${String(
    parts.d
  ).padStart(2, "0")}`;
  if (todayStr !== dateStr) return true;
  const nowMin = parts.h * 60 + parts.m;
  const cand = parseTimeHHmm(startHHmm);
  const candMin = cand.h * 60 + cand.m;
  return (
    candMin >= nowMin + (Number.isFinite(bufferMinutes) ? bufferMinutes : 0)
  );
}

export function daysFromTodayJakarta(dateStr: string): number {
  const { y, mo, d } = jakartaNowParts();
  const today = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  const [yy, mm, dd] = dateStr.split("-").map((n) => parseInt(n, 10));
  const target = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  const diffDays = Math.floor((target - today) / 86_400_000);
  return diffDays;
}

export function getPickupConfig() {
  // Default jam operasional sesuai spesifikasi: 09:00–21:00 (Asia/Jakarta)
  const open = String(process.env.PICKUP_OPEN || "09:00");
  const close = String(process.env.PICKUP_CLOSE || "20:00");
  const slot = parseInt(String(process.env.PICKUP_SLOT_MINUTES || "60"), 10);
  const buffer = parseInt(
    String(process.env.PICKUP_SAME_DAY_BUFFER_MINUTES || "120"),
    10
  );
  return {
    open,
    close,
    slotMinutes: Number.isFinite(slot) ? slot : 60,
    bufferMinutes: Number.isFinite(buffer) ? buffer : 120,
  };
}
