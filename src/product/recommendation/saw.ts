import { Weights, ScoreBreakdown } from "./types";

export const sizeIndex = (s: any): number => {
  const m: Record<string, number> = {
    S: 1,
    M: 2,
    L: 3,
    XL: 4,
    XXL: 4,
    KECIL: 1,
    SEDANG: 2,
    BESAR: 3,
    "SANGAT BESAR": 4,
  };
  const key = String(s || "")
    .toUpperCase()
    .trim();
  const v = m[key];
  return typeof v === "number" ? v : 1; // Default to Small (1)
};

export const normalizePrice = (
  min: number,
  max: number,
  price: number
): number => {
  // SAW Cost Attribute: Min / Value
  if (price <= 0) return 0; // Avoid division by zero
  if (min <= 0) return 0;
  return min / price;
};

export const normalizePopularity = (maxSold: number, sold: number): number => {
  // SAW Benefit Attribute: Value / Max
  if (!isFinite(maxSold) || maxSold <= 0) return 0;
  return (sold || 0) / maxSold;
};

export const normalizeSize = (
  minIdx: number,
  maxIdx: number,
  idx: number
): number => {
  // SAW Benefit Attribute: Value / Max
  // We use fixed Max=4 based on user requirement (Sangat Besar = 4)
  const MAX_SIZE_SCORE = 4;
  return idx / MAX_SIZE_SCORE;
};

export const computeSawScore = (
  inputs: { priceNorm: number; popularityNorm: number; sizeNorm: number },
  weights: Weights
): {
  score: number;
  breakdown: ScoreBreakdown;
  primaryReason: "Price" | "Popularity" | "Size";
} => {
  const priceC = inputs.priceNorm * weights.price;
  const popC = inputs.popularityNorm * weights.popularity;
  const sizeC = inputs.sizeNorm * weights.size;
  const score = priceC + popC + sizeC;
  const idx = popC >= priceC && popC >= sizeC ? 1 : priceC >= sizeC ? 0 : 2;
  const primaryReason = idx === 0 ? "Price" : idx === 1 ? "Popularity" : "Size";
  const breakdown: ScoreBreakdown = {
    priceNorm: inputs.priceNorm,
    popularityNorm: inputs.popularityNorm,
    sizeNorm: inputs.sizeNorm,
    weights,
  };
  return { score, breakdown, primaryReason };
};
