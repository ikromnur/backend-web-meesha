import { getPickupConfig, isWithinOperatingHours } from "./timezone";

type Availability =
  | "READY"
  | "PREORDER_1D"
  | "PREORDER_2D"
  | "PREORDER_3D"
  | "PREORDER_4D"
  | "PREORDER_5D";

// Hitung minPickupAt (UTC Date) berdasar createdAt (UTC) dan daftar availability produk
export function calculateMinPickupAt(
  createdAtUtc: Date,
  availabilities: Availability[]
): Date {
  const { open, close } = getPickupConfig();

  // Tentukan offset hari maksimum berdasarkan produk dalam cart
  const dayOffset = availabilities.reduce((max, a) => {
    switch (a) {
      case "READY":
        return Math.max(max, 0);
      case "PREORDER_1D":
        return Math.max(max, 1);
      case "PREORDER_2D":
        return Math.max(max, 2);
      case "PREORDER_3D":
        return Math.max(max, 3);
      case "PREORDER_4D":
        return Math.max(max, 4);
      case "PREORDER_5D":
        return Math.max(max, 5);
      default:
        return max;
    }
  }, 0);

  // Konversi createdAt ke waktu lokal Jakarta (UTC+7) untuk perhitungan jam operasional
  const createdJakarta = toJakartaLocal(createdAtUtc);
  const openParts = hhmmToParts(open);

  if (dayOffset === 0) {
    // READY STOCK: Buffer 3 jam (Calculated within operating hours)
    const durationMinutes = 3 * 60;

    // Start calculation from created time
    let current = toJakartaLocal(createdAtUtc);
    let remainingMinutes = durationMinutes;

    const closeParts = hhmmToParts(close); // Re-added this line

    const openMins = openParts.h * 60 + openParts.m;
    const closeMins = closeParts.h * 60 + closeParts.m;

    // Safety loop to prevent infinite loops (max 5 days)
    for (let i = 0; i < 5; i++) {
      const currentMins = current.hours * 60 + current.minutes;

      // 1. If before open, jump to open
      if (currentMins < openMins) {
        current.hours = openParts.h;
        current.minutes = openParts.m;
        current.seconds = 0;
        // Recalculate mins
      }
      // 2. If after close, jump to next day open
      else if (currentMins >= closeMins) {
        current = addDaysJakarta(current, 1);
        current.hours = openParts.h;
        current.minutes = openParts.m;
        current.seconds = 0;
        continue; // Retry logic with new time
      }

      // 3. Calculate available time today
      // Re-read current mins after potential adjustments
      const validStartMins = current.hours * 60 + current.minutes;
      const availableToday = closeMins - validStartMins;

      if (availableToday >= remainingMinutes) {
        // Can finish today
        const finishDate = jakartaPartsToUtc(current); // Base UTC
        // Add remaining minutes
        return new Date(finishDate.getTime() + remainingMinutes * 60000);
      } else {
        // Cannot finish today, use up all available time and move to next day
        remainingMinutes -= availableToday;
        current = addDaysJakarta(current, 1);
        current.hours = openParts.h;
        current.minutes = openParts.m;
        current.seconds = 0;
      }
    }

    // Fallback if loop exhausted (should not happen for reasonable durations)
    return jakartaPartsToUtc(current);
  }

  // Jika PREORDER atau dibuat di luar jam operasional, set ke hari berikutnya (atau offset) pada jam buka
  const targetJakarta = addDaysJakarta(createdJakarta, dayOffset || 1);
  targetJakarta.hours = openParts.h;
  targetJakarta.minutes = openParts.m;
  targetJakarta.seconds = 0;

  // Kembalikan sebagai UTC Date
  return jakartaPartsToUtc(targetJakarta);
}

// Helpers lokal Jakarta
function toJakartaLocal(d: Date): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  hhmm: string;
} {
  // Offset Asia/Jakarta UTC+7
  const t = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const year = t.getUTCFullYear();
  const month = t.getUTCMonth() + 1;
  const day = t.getUTCDate();
  const hours = t.getUTCHours();
  const minutes = t.getUTCMinutes();
  const seconds = t.getUTCSeconds();
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return { year, month, day, hours, minutes, seconds, hhmm: `${hh}:${mm}` };
}

function addDaysJakarta(
  parts: {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
    seconds: number;
  },
  days: number
) {
  const utc = jakartaPartsToUtc(parts);
  const added = new Date(utc.getTime() + days * 24 * 60 * 60 * 1000);
  return toJakartaLocal(added);
}

function jakartaPartsToUtc(parts: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}) {
  // Buat Date di Jakarta kemudian konversi ke UTC
  const hh = String(parts.hours).padStart(2, "0");
  const mm = String(parts.minutes).padStart(2, "0");
  const ss = String(parts.seconds).padStart(2, "0");
  // Representasikan sebagai ISO lokal Jakarta (palsu) lalu kurangi offset 7 jam
  const jakartaIso = `${String(parts.year).padStart(4, "0")}-${String(
    parts.month
  ).padStart(2, "0")}-${String(parts.day).padStart(
    2,
    "0"
  )}T${hh}:${mm}:${ss}.000Z`;
  const utcFromJakarta = new Date(
    new Date(jakartaIso).getTime() - 7 * 60 * 60 * 1000
  );
  return utcFromJakarta;
}

function hhmmToParts(hhmm: string) {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}
