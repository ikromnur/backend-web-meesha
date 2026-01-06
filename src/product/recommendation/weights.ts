import { Weights } from "./types";
import { HttpError } from "../../utils/http-error";

// SAW Weights based on user requirement:
// Price (Cost): 5 -> 5/12 ~= 0.4167
// Popularity (Benefit): 4 -> 4/12 ~= 0.3333
// Size (Benefit): 3 -> 3/12 = 0.25
const DEFAULT_WEIGHTS: Weights = { price: 0.4167, popularity: 0.3333, size: 0.25 };

export const parseWeights = (input: string | Partial<Weights> | undefined): Weights => {
  if (!input) return { ...DEFAULT_WEIGHTS };
  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return { ...DEFAULT_WEIGHTS };
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    const map: Record<string, number> = {};
    for (const part of parts) {
      const [k, v] = part.split(":");
      if (!k || v === undefined) continue;
      const num = Number(v);
      if (isNaN(num) || num < 0) throw new HttpError(400, "Invalid weights");
      map[k.toLowerCase()] = num;
    }
    return {
      price: map.price ?? DEFAULT_WEIGHTS.price,
      popularity: map.popularity ?? DEFAULT_WEIGHTS.popularity,
      size: map.size ?? DEFAULT_WEIGHTS.size,
    };
  }
  const w = input as Partial<Weights>;
  const result: Weights = {
    price: typeof w.price === "number" ? w.price : DEFAULT_WEIGHTS.price,
    popularity: typeof w.popularity === "number" ? w.popularity : DEFAULT_WEIGHTS.popularity,
    size: typeof w.size === "number" ? w.size : DEFAULT_WEIGHTS.size,
  };
  if (result.price < 0 || result.popularity < 0 || result.size < 0) {
    throw new HttpError(400, "Invalid weights");
  }
  return result;
};

export const normalizeWeights = (w: Weights): Weights => {
  const sum = w.price + w.popularity + w.size;
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    price: w.price / sum,
    popularity: w.popularity / sum,
    size: w.size / sum,
  };
};

export const defaultWeights = (): Weights => ({ ...DEFAULT_WEIGHTS });
