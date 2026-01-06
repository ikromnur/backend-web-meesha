import prisma from "../../lib/prisma";
import { getCachedAny, setCachedAny } from "../../utils/cache";
import { Weights, RecommendationsResponse } from "./types";
import {
  sizeIndex,
  normalizePrice,
  normalizePopularity,
  normalizeSize,
  computeSawScore,
} from "./saw";

type Filters = {
  search?: string;
  category?: string[];
  // type?: string[];
  objective?: string[];
  color?: string[];
  size?: string[];
  price?: { gte?: number; lte?: number };
};

const buildWhere = (filters: Filters): any => {
  const w: any = {};
  if (filters.search && filters.search.trim()) {
    w.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.category && filters.category.length)
    w.category = { key: { in: filters.category } };
  /*
  if (filters.type && filters.type.length)
    w.type = { key: { in: filters.type } };
  */
  if (filters.objective && filters.objective.length)
    w.objective = { key: { in: filters.objective } };
  if (filters.color && filters.color.length)
    w.color = { key: { in: filters.color } };
  if (filters.size && filters.size.length) w.size = { in: filters.size };
  if (
    filters.price &&
    (filters.price.gte !== undefined || filters.price.lte !== undefined)
  ) {
    w.price = {
      ...(filters.price.gte !== undefined && { gte: filters.price.gte }),
      ...(filters.price.lte !== undefined && { lte: filters.price.lte }),
    };
  }
  return w;
};

const stableStringify = (obj: any): string => {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  const out: any = {};
  for (const k of keys)
    out[k] = Array.isArray(obj[k]) ? [...obj[k]].sort() : obj[k];
  return JSON.stringify(out);
};

export const getRecommendations = async (params: {
  filters: Filters;
  period: number;
  weights: Weights;
  limit: number;
}): Promise<RecommendationsResponse> => {
  const { filters, period, weights, limit } = params;
  const weightsKey = `${weights.price.toFixed(4)}:${weights.popularity.toFixed(
    4
  )}:${weights.size.toFixed(4)}`;
  const cacheKey = `recs:v2:${period}:${weightsKey}:${stableStringify(
    filters
  )}`;
  const cached = getCachedAny<RecommendationsResponse>(
    cacheKey,
    1000 * 60 * 5 // 5 minutes cache (reduced from 1 hour)
  );
  if (cached) return cached;

  const now = new Date();
  const since = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);

  const candidates = await prisma.product.findMany({
    where: buildWhere(filters),
    include: {
      category: { select: { id: true, key: true, name: true } },
      objective: { select: { id: true, key: true, name: true } },
      color: { select: { id: true, key: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });

  const useCandidates = candidates.length
    ? candidates
    : await prisma.product.findMany({
        include: {
          category: { select: { id: true, key: true, name: true } },
          // type: { select: { id: true, key: true, name: true } },
          objective: { select: { id: true, key: true, name: true } },
          color: { select: { id: true, key: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 1000,
      });

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["COMPLETED", "PROCESSING"] },
      paidAt: { gte: since, lt: now },
    },
    include: { orderItems: true },
  });
  const soldMap = new Map<string, number>();
  for (const o of orders)
    for (const it of o.orderItems)
      soldMap.set(it.productId, (soldMap.get(it.productId) || 0) + it.quantity);

  let minPrice = Number.POSITIVE_INFINITY,
    maxPrice = 0,
    minSize = Number.POSITIVE_INFINITY,
    maxSize = 0,
    maxSold = 0;

  for (const p of useCandidates) {
    const price = Number(p.price || 0);
    minPrice = Math.min(minPrice, price);
    maxPrice = Math.max(maxPrice, price);
    const si = sizeIndex(p.size);
    minSize = Math.min(minSize, si);
    maxSize = Math.max(maxSize, si);
    const sold = soldMap.get(p.id) || 0;
    maxSold = Math.max(maxSold, sold);
  }

  const items = useCandidates.map((p) => {
    const price = Number(p.price || 0);
    const si = sizeIndex(p.size);
    const sold = soldMap.get(p.id) || 0;
    const priceNorm = normalizePrice(minPrice, maxPrice, price);
    const popularityNorm = normalizePopularity(maxSold, sold);
    const sizeNorm = normalizeSize(minSize, maxSize, si);
    const { score, breakdown, primaryReason } = computeSawScore(
      { priceNorm, popularityNorm, sizeNorm },
      weights
    );
    const product = (({ categoryId, objectiveId, colorId, ...rest }) => rest)(
      p
    );
    return {
      product,
      stats: { sold_30d: sold, views_30d: 0 },
      score,
      scoreBreakdown: breakdown,
      primaryReason,
      sold,
    };
  });

  items.sort((a: any, b: any) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sold !== a.sold) return b.sold - a.sold;
    const ap = Number(a.product.price || 0);
    const bp = Number(b.product.price || 0);
    if (ap !== bp) return ap - bp;
    const ad = new Date(a.product.updatedAt).getTime();
    const bd = new Date(b.product.updatedAt).getTime();
    if (bd !== ad) return bd - ad;
    return String(a.product.id).localeCompare(String(b.product.id));
  });

  const limited = items
    .slice(0, limit)
    .map(({ product, stats, score, scoreBreakdown, primaryReason }) => ({
      product,
      stats,
      score,
      scoreBreakdown,
      primaryReason,
      badge: "Hotsale",
    }));
  const payload: RecommendationsResponse = {
    data: limited,
    limit,
    period,
    weights,
  };
  setCachedAny(cacheKey, payload);
  return payload;
};
