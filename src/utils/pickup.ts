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
    // READY STOCK: Buffer 3 jam
    const bufferMs = 3 * 60 * 60 * 1000;
    // Gunakan createdAt yang sudah dibulatkan ke menit/detik 00 agar tidak gagal validasi karena milidetik
    const baseTime = new Date(createdAtUtc);
    baseTime.setSeconds(0, 0);
    const candidateUtc = new Date(baseTime.getTime() + bufferMs);
    const candidateJakarta = toJakartaLocal(candidateUtc);

    const closeParts = hhmmToParts(close);

    const candMins = candidateJakarta.hours * 60 + candidateJakarta.minutes;
    const openMins = openParts.h * 60 + openParts.m;
    const closeMins = closeParts.h * 60 + closeParts.m;

    if (candMins < openMins) {
      // Belum buka, geser ke jam buka hari tersebut
      candidateJakarta.hours = openParts.h;
      candidateJakarta.minutes = openParts.m;
      candidateJakarta.seconds = 0;
      return jakartaPartsToUtc(candidateJakarta);
    } else if (candMins > closeMins) {
      // Sudah tutup, geser ke jam buka hari berikutnya
      // Gunakan candidateJakarta sebagai basis agar hari sudah sesuai (jika rollover)
      const nextDay = addDaysJakarta(candidateJakarta, 1);
      nextDay.hours = openParts.h;
      nextDay.minutes = openParts.m;
      nextDay.seconds = 0;
      return jakartaPartsToUtc(nextDay);
    } else {
      // Within hours
      return candidateUtc;
    }
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
