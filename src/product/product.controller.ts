import express from "express";
import { Request, Response, NextFunction } from "express";
import multer from "multer";
const storage = multer.memoryStorage();
const uploadFields = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype && file.mimetype.startsWith("image/"))
      return cb(null, true);
    cb(new HttpError(400, "Only image/* mime types are allowed"));
  },
}).fields([
  { name: "images", maxCount: 5 },
  { name: "imageUrl", maxCount: 1 },
]);
import {
  createProductService,
  getAllProductsService,
  getProductByIdService,
  updateProductService,
  deleteProductService,
  getMetaService,
} from "./product.service";
import { Product, ProductFilter, Availability } from "../types/product";
import { Size } from "@prisma/client";
import { authenticate, authorizeAdmin } from "../middleware/auth.middleware";
import { HttpError } from "../utils/http-error";
import prisma from "../lib/prisma";
import { getCachedAny, setCachedAny, invalidatePrefix } from "../utils/cache";
import { getRecommendations } from "./recommendation/service";
import type { Weights } from "./recommendation/types";

const router = express.Router();

// Helper function untuk safe JSON parse
const safeJsonParse = (str: string, fieldName: string) => {
  if (!str || str === "undefined" || str === "null") return undefined;
  try {
    return JSON.parse(str);
  } catch (e) {
    throw new HttpError(400, `Invalid JSON format for ${fieldName}`);
  }
};

// Helper function untuk parse product data
const parseProductData = (body: any) => {
  let rawAvailability = String((body?.availability ?? "").toString())
    .trim()
    .toUpperCase();

  // Helper safe number parsing (handles "330.000" -> 330000)
  const safeNumber = (v: any) => {
    if (v === undefined || v === null) return undefined;
    // Hapus karakter non-digit (misal titik ribuan) kecuali jika itu decimal point yang valid (kita asumsi rupiah integer)
    const s = String(v).replace(/[^0-9]/g, "");
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  };

  // Normalize labels to enum values
  if (rawAvailability === "PO 2 HARI" || rawAvailability === "PO-2 HARI") {
    rawAvailability = "PO_2_DAY";
  } else if (
    rawAvailability === "PO 5 HARI" ||
    rawAvailability === "PO-5 HARI"
  ) {
    rawAvailability = "PO_5_DAY";
  } else if (
    rawAvailability === "READY DI TOKO" ||
    rawAvailability === "READY STOK" ||
    rawAvailability === "READY STOCK"
  ) {
    rawAvailability = "READY";
  }

  const validAvailability = new Set(["READY", "PO_2_DAY", "PO_5_DAY"]);
  return {
    ...body,
    ...(body.price !== undefined && { price: safeNumber(body.price) }),
    ...(body.stock !== undefined && { stock: safeNumber(body.stock) }),
    ...(body.variant && { variant: safeJsonParse(body.variant, "variant") }),
    ...(body.category && {
      category: safeJsonParse(body.category, "category"),
    }),
    // type removed
    ...(body.objective && {
      objective: safeJsonParse(body.objective, "objective"),
    }),
    ...(body.color && { color: safeJsonParse(body.color, "color") }),
    ...(rawAvailability
      ? validAvailability.has(rawAvailability)
        ? { availability: rawAvailability }
        : (() => {
            throw new HttpError(
              400,
              "availability harus salah satu: READY, PO_2_DAY, PO_5_DAY"
            );
          })()
      : {}),
  };
};

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Helper untuk normalisasi array dari query (mendukung CSV dan array)
    const normArray = (v: unknown): string[] | undefined => {
      if (v === undefined || v === null) return undefined;
      if (Array.isArray(v))
        return v.filter((x) => typeof x === "string") as string[];
      if (typeof v === "string") {
        if (v.trim() === "") return undefined;
        return v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
      return undefined;
    };

    // Limit aliases: limit, pageSize, per_page, take. Dukungan 'all'
    const rawLimit = (req.query.limit ??
      req.query.pageSize ??
      req.query.per_page ??
      req.query.take) as string | string[] | undefined;
    let limitAll = false;
    let limitNum: number | undefined;
    const MAX_LIMIT = 1000;
    if (Array.isArray(rawLimit)) {
      // Ambil elemen pertama jika array
      const first = rawLimit[0];
      if (first && typeof first === "string") {
        if (first.toLowerCase() === "all") {
          limitAll = true;
        } else if (!isNaN(Number(first))) {
          limitNum = Math.min(Math.max(Number(first), 1), MAX_LIMIT);
        }
      }
    } else if (typeof rawLimit === "string") {
      if (rawLimit.toLowerCase() === "all") {
        limitAll = true;
      } else if (!isNaN(Number(rawLimit))) {
        limitNum = Math.min(Math.max(Number(rawLimit), 1), MAX_LIMIT);
      }
    }

    // Page
    const rawPage = req.query.page as string | undefined;
    let pageNum =
      rawPage && !isNaN(Number(rawPage)) ? Math.max(Number(rawPage), 1) : 1;
    if (limitAll) {
      // Jika all, set page=1 agar skip=0
      pageNum = 1;
      limitNum = MAX_LIMIT;
    }

    // Search
    const search = (req.query.search as string | undefined) ?? undefined;

    // Budget gte/lte
    let gte =
      typeof req.query.gte === "string" && !isNaN(Number(req.query.gte))
        ? Number(req.query.gte)
        : undefined;
    let lte =
      typeof req.query.lte === "string" && !isNaN(Number(req.query.lte))
        ? Number(req.query.lte)
        : undefined;
    // Auto-swap jika lte < gte agar tetap mendapatkan hasil
    if (gte !== undefined && lte !== undefined && lte < gte) {
      const tmp = gte;
      gte = lte;
      lte = tmp;
    }
    const priceFilter =
      gte !== undefined || lte !== undefined ? { gte, lte } : undefined;

    // Array filters
    const category = normArray(req.query.categories);
    // const type = normArray(req.query.types);
    const objective = normArray(req.query.objectives);
    const color = normArray(req.query.colors);

    // Size enum: validasi terhadap enum Prisma Size
    const rawSize = normArray(req.query.size);
    const validSizes = new Set(["S", "M", "L", "XL", "XXL"]);
    const size = rawSize?.filter((s) =>
      validSizes.has(String(s).toUpperCase())
    ) as Size[] | undefined;

    // Availability enum: validasi dan normalisasi dari query
    const rawAvailability = normArray(
      (req.query as any).availability || (req.query as any).availabilities
    );
    const validAvailability = new Set(["READY", "PO_2_DAY", "PO_5_DAY"]);
    const availability = rawAvailability
      ?.map((a: string) => String(a).toUpperCase())
      .filter((a: string) => validAvailability.has(a)) as
      | Availability[]
      | undefined;

    const filters: ProductFilter = {
      search,
      category,
      // type,
      objective,
      color,
      availability: availability,
      size,
      price: priceFilter,
      page: pageNum,
      limit: limitNum ?? 10,
    };

    const result = await getAllProductsService(filters);

    // Kembalikan struktur konsisten untuk FE admin: data, page, totalPages, total & totalItems
    const response = {
      data: (result.data as any[]).map((p: any) => ({
        ...p,
        images: (() => {
          const v = p.imageUrl;
          if (!v) return [];
          if (Array.isArray(v)) return v;
          if (typeof v === "object" && v.url && v.publicId) return [v];
          if (typeof v === "string") return [{ url: v, publicId: "" }];
          return [];
        })(),
      })),
      page: result.page,
      total: result.total,
      totalItems: result.total,
      totalPages: result.totalPages,
    } as any;
    // Jika user meminta limit=all, set totalPages=1 agar UI satu halaman
    if (limitAll) {
      response.totalPages = 1;
    }
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

router.get("/meta", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meta = await getMetaService();
    return res.json(meta);
  } catch (error) {
    next(error);
  }
});

router.get(
  "/popular",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clampNum = (v: any, def: number, min: number, max: number) => {
        const s = String(v ?? "").trim();
        if (!s || isNaN(Number(s))) return def;
        return Math.max(min, Math.min(Number(s), max));
      };

      const mode = String(req.query.mode || "saw").toLowerCase();
      const limit = clampNum(req.query.limit, 10, 1, 50);
      const period = clampNum(req.query.period, 30, 1, 365);

      if (mode === "saw") {
        const normArray = (v: unknown): string[] | undefined => {
          if (v === undefined || v === null) return undefined;
          if (Array.isArray(v))
            return v.filter((x) => typeof x === "string") as string[];
          if (typeof v === "string") {
            if (v.trim() === "") return undefined;
            return v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
          }
          return undefined;
        };

        let weights: Weights = {
          price: 0.4167,
          popularity: 0.3333,
          size: 0.25,
        };
        const wp = Number((req.query as any)["weights.price"]);
        const wpop = Number((req.query as any)["weights.popularity"]);
        const ws = Number((req.query as any)["weights.size"]);
        const providedNested = !isNaN(wp) || !isNaN(wpop) || !isNaN(ws);
        if (providedNested) {
          const cand: Weights = {
            price: isNaN(wp) || wp < 0 ? weights.price : wp,
            popularity: isNaN(wpop) || wpop < 0 ? weights.popularity : wpop,
            size: isNaN(ws) || ws < 0 ? weights.size : ws,
          };
          const sum = cand.price + cand.popularity + cand.size;
          weights =
            sum > 0
              ? {
                  price: cand.price / sum,
                  popularity: cand.popularity / sum,
                  size: cand.size / sum,
                }
              : weights;
        } else {
          const weightsRaw = String((req.query as any).weights || "").trim();
          if (weightsRaw) {
            if (weightsRaw.startsWith("{")) {
              try {
                const obj = JSON.parse(weightsRaw || "{}");
                const cand: Weights = {
                  price:
                    typeof obj.price === "number" && obj.price >= 0
                      ? obj.price
                      : weights.price,
                  popularity:
                    typeof obj.popularity === "number" && obj.popularity >= 0
                      ? obj.popularity
                      : weights.popularity,
                  size:
                    typeof obj.size === "number" && obj.size >= 0
                      ? obj.size
                      : weights.size,
                };
                const sum = cand.price + cand.popularity + cand.size;
                weights =
                  sum > 0
                    ? {
                        price: cand.price / sum,
                        popularity: cand.popularity / sum,
                        size: cand.size / sum,
                      }
                    : weights;
              } catch (_) {
                const parts = weightsRaw
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean);
                const map: Record<string, number> = {};
                for (const part of parts) {
                  const [k, v] = part.split(":");
                  if (!k || v === undefined) continue;
                  const num = Number(v);
                  if (!isNaN(num) && num >= 0) map[k.toLowerCase()] = num;
                }
                const cand: Weights = {
                  price: map.price ?? weights.price,
                  popularity: map.popularity ?? weights.popularity,
                  size: map.size ?? weights.size,
                };
                const sum = cand.price + cand.popularity + cand.size;
                weights =
                  sum > 0
                    ? {
                        price: cand.price / sum,
                        popularity: cand.popularity / sum,
                        size: cand.size / sum,
                      }
                    : weights;
              }
            } else {
              const parts = weightsRaw
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              const map: Record<string, number> = {};
              for (const part of parts) {
                const [k, v] = part.split(":");
                if (!k || v === undefined) continue;
                const num = Number(v);
                if (!isNaN(num) && num >= 0) map[k.toLowerCase()] = num;
              }
              const cand: Weights = {
                price: map.price ?? weights.price,
                popularity: map.popularity ?? weights.popularity,
                size: map.size ?? weights.size,
              };
              const sum = cand.price + cand.popularity + cand.size;
              weights =
                sum > 0
                  ? {
                      price: cand.price / sum,
                      popularity: cand.popularity / sum,
                      size: cand.size / sum,
                    }
                  : weights;
            }
          }
        }

        const filters = {
          search: (req.query.search as string | undefined) ?? undefined,
          category: normArray(
            (req.query as any).category || (req.query as any).categories
          ),
          // type: normArray((req.query as any).type || (req.query as any).types),
          objective: normArray(
            (req.query as any).objective || (req.query as any).objectives
          ),
          color: normArray(
            (req.query as any).color || (req.query as any).colors
          ),
          size: normArray((req.query as any).size),
          price: undefined as any,
        } as any;

        let gte =
          typeof req.query.gte === "string" && !isNaN(Number(req.query.gte))
            ? Number(req.query.gte)
            : undefined;
        let lte =
          typeof req.query.lte === "string" && !isNaN(Number(req.query.lte))
            ? Number(req.query.lte)
            : undefined;
        if (gte !== undefined && lte !== undefined && lte < gte) {
          const tmp = gte;
          gte = lte;
          lte = tmp;
        }
        filters.price =
          gte !== undefined || lte !== undefined ? { gte, lte } : undefined;

        const payload = await getRecommendations({
          filters,
          period,
          weights,
          limit,
        });
        return res.status(200).json(payload);
      }

      const rawLimit = String(req.query.limit || "").trim();
      const rawPeriod = String(req.query.period || "").trim();
      const sort = String(req.query.sort || "sold_desc").toLowerCase();
      const includeStats = String(
        req.query.includeStats || "true"
      ).toLowerCase();

      const cacheKey = `popular:v1:${limit}:${period}:${sort}:${includeStats}`;
      const cached = getCachedAny<any>(cacheKey, 1000 * 60 * 10);
      if (cached) return res.status(200).json(cached);

      const now = new Date();
      const since = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
      const orders = await prisma.order.findMany({
        where: { status: "COMPLETED", paidAt: { gte: since, lt: now } },
        include: { orderItems: true },
      });
      const soldMap = new Map<string, number>();
      for (const o of orders)
        for (const it of o.orderItems)
          soldMap.set(
            it.productId,
            (soldMap.get(it.productId) || 0) + it.quantity
          );
      const products = await prisma.product.findMany({
        include: {
          category: { select: { id: true, key: true, name: true } },
          // type: { select: { id: true, key: true, name: true } },
          objective: { select: { id: true, key: true, name: true } },
          color: { select: { id: true, key: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 1000,
      });
      const items = products.map((p) => ({
        product: (({ categoryId, objectiveId, colorId, ...rest }) => rest)(p),
        stats:
          includeStats !== "false"
            ? { sold_30d: soldMap.get(p.id) || 0, views_30d: 0 }
            : undefined,
        sold: soldMap.get(p.id) || 0,
        views: 0,
      }));
      const cmp = (a: any, b: any) => {
        if (sort === "views_desc") {
          if (b.views !== a.views) return b.views - a.views;
          if (b.sold !== a.sold) return b.sold - a.sold;
        } else if (sort === "popularity_desc") {
          const ap = a.sold + a.views;
          const bp = b.sold + b.views;
          if (bp !== ap) return bp - ap;
        } else {
          if (b.sold !== a.sold) return b.sold - a.sold;
          if (b.views !== a.views) return b.views - a.views;
        }
        const ad = new Date(a.product.updatedAt).getTime();
        const bd = new Date(b.product.updatedAt).getTime();
        if (bd !== ad) return bd - ad;
        return String(a.product.id).localeCompare(String(b.product.id));
      };
      items.sort(cmp);
      const limitedItems = items
        .slice(0, limit)
        .map(({ product, stats }) => ({ product, stats }));
      const payload = { data: limitedItems, limit, period, sort };
      setCachedAny(cacheKey, payload);
      return res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/recommendations",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clampNum = (v: any, def: number, min: number, max: number) => {
        const s = String(v ?? "").trim();
        if (!s || isNaN(Number(s))) return def;
        return Math.max(min, Math.min(Number(s), max));
      };

      const limit = clampNum(req.query.limit, 10, 1, 50);
      const period = clampNum(req.query.period, 30, 1, 365);

      const normArray = (v: unknown): string[] | undefined => {
        if (v === undefined || v === null) return undefined;
        if (Array.isArray(v))
          return v.filter((x) => typeof x === "string") as string[];
        if (typeof v === "string") {
          if (v.trim() === "") return undefined;
          return v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        }
        return undefined;
      };

      let weights: Weights = { price: 0.4167, popularity: 0.3333, size: 0.25 };
      const wp = Number((req.query as any)["weights.price"]);
      const wpop = Number((req.query as any)["weights.popularity"]);
      const ws = Number((req.query as any)["weights.size"]);
      const providedNested = !isNaN(wp) || !isNaN(wpop) || !isNaN(ws);

      if (providedNested) {
        const cand: Weights = {
          price: isNaN(wp) || wp < 0 ? weights.price : wp,
          popularity: isNaN(wpop) || wpop < 0 ? weights.popularity : wpop,
          size: isNaN(ws) || ws < 0 ? weights.size : ws,
        };
        const sum = cand.price + cand.popularity + cand.size;
        weights =
          sum > 0
            ? {
                price: cand.price / sum,
                popularity: cand.popularity / sum,
                size: cand.size / sum,
              }
            : weights;
      } else {
        const weightsRaw = String((req.query as any).weights || "").trim();
        if (weightsRaw) {
          if (weightsRaw.startsWith("{")) {
            try {
              const obj = JSON.parse(weightsRaw || "{}");
              const cand: Weights = {
                price:
                  typeof obj.price === "number" && obj.price >= 0
                    ? obj.price
                    : weights.price,
                popularity:
                  typeof obj.popularity === "number" && obj.popularity >= 0
                    ? obj.popularity
                    : weights.popularity,
                size:
                  typeof obj.size === "number" && obj.size >= 0
                    ? obj.size
                    : weights.size,
              };
              const sum = cand.price + cand.popularity + cand.size;
              weights =
                sum > 0
                  ? {
                      price: cand.price / sum,
                      popularity: cand.popularity / sum,
                      size: cand.size / sum,
                    }
                  : weights;
            } catch (_) {}
          } else {
            const parts = weightsRaw
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            const map: Record<string, number> = {};
            for (const part of parts) {
              const [k, v] = part.split(":");
              if (!k || v === undefined) continue;
              const num = Number(v);
              if (!isNaN(num) && num >= 0) map[k.toLowerCase()] = num;
            }
            const cand: Weights = {
              price: map.price ?? weights.price,
              popularity: map.popularity ?? weights.popularity,
              size: map.size ?? weights.size,
            };
            const sum = cand.price + cand.popularity + cand.size;
            weights =
              sum > 0
                ? {
                    price: cand.price / sum,
                    popularity: cand.popularity / sum,
                    size: cand.size / sum,
                  }
                : weights;
          }
        }
      }

      const filters = {
        search: (req.query.search as string | undefined) ?? undefined,
        category: normArray(
          (req.query as any).category || (req.query as any).categories
        ),
        objective: normArray(
          (req.query as any).objective || (req.query as any).objectives
        ),
        color: normArray((req.query as any).color || (req.query as any).colors),
        size: normArray((req.query as any).size),
        price: undefined as any,
      } as any;

      let gte =
        typeof req.query.gte === "string" && !isNaN(Number(req.query.gte))
          ? Number(req.query.gte)
          : undefined;
      let lte =
        typeof req.query.lte === "string" && !isNaN(Number(req.query.lte))
          ? Number(req.query.lte)
          : undefined;
      if (gte !== undefined && lte !== undefined && lte < gte) {
        const tmp = gte;
        gte = lte;
        lte = tmp;
      }
      filters.price =
        gte !== undefined || lte !== undefined ? { gte, lte } : undefined;

      const payload = await getRecommendations({
        filters,
        period,
        weights,
        limit,
      });
      return res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log(
      `[GET /products/:id] Request received for ID: ${req.params.id}`
    );
    const product: any = await getProductByIdService(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    console.log(`[GET /products/:id] Product found. Processing images...`);
    res.status(200).json({
      data: {
        ...product,
        images: (() => {
          const v = product.imageUrl;
          if (!v) return [];
          if (Array.isArray(v)) return v;
          if (typeof v === "object" && v.url && v.publicId) return [v];
          if (typeof v === "string") return [{ url: v, publicId: "" }];
          return [];
        })(),
      },
    });
  } catch (error) {
    console.error(
      `[GET /products/:id] Error occurred for ID ${req.params.id}:`,
      error
    );
    if (error instanceof Error && error.stack) console.error(error.stack);
    next(error);
  }
});

router.post(
  "/",
  authenticate,
  authorizeAdmin,
  uploadFields,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.body;

      const parsedData = {
        ...raw,
        price: Number(String(raw.price).replace(/[^0-9]/g, "")),
        stock: Number(String(raw.stock).replace(/[^0-9]/g, "")),
        variant: safeJsonParse(raw.variant, "variant"),
        category: safeJsonParse(raw.category, "category"),
        objective: safeJsonParse(raw.objective, "objective"),
        color: safeJsonParse(raw.color, "color"),
        availability: (() => {
          const av = String((raw.availability ?? "READY").toString())
            .trim()
            .toUpperCase();
          const ok = ["READY", "PO_2_DAY", "PO_5_DAY"].includes(av);
          if (!ok) {
            throw new HttpError(
              400,
              "availability harus salah satu: READY, PO_2_DAY, PO_5_DAY"
            );
          }
          return av;
        })(),
      };

      const filesMap = ((req as any).files || {}) as Record<
        string,
        Express.Multer.File[]
      >;
      const imagesFiles = Array.isArray(filesMap.images) ? filesMap.images : [];
      const legacyFile = Array.isArray(filesMap.imageUrl)
        ? filesMap.imageUrl[0]
        : undefined;

      const product = await createProductService(
        parsedData,
        imagesFiles.length ? imagesFiles : legacyFile ? [legacyFile] : []
      );

      res.status(201).json({
        data: {
          ...product,
          images: (() => {
            const v = (product as any).imageUrl;
            if (!v) return [];
            if (Array.isArray(v)) return v;
            if (typeof v === "object" && v.url && v.publicId) return [v];
            if (typeof v === "string") return [{ url: v, publicId: "" }];
            return [];
          })(),
        },
        message: "Product created successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:id",
  authenticate,
  authorizeAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deletedProduct = await deleteProductService(req.params.id);
      res.status(200).json({
        data: deletedProduct,
        message: "Product permanently deleted",
      });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/:id",
  authenticate,
  authorizeAdmin,
  uploadFields,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log(`[PUT /products/${req.params.id}] Updating product...`);
      console.log("Raw Body:", req.body);

      const parsedData = parseProductData(req.body);
      console.log("Parsed Data:", parsedData);

      const filesMap = ((req as any).files || {}) as Record<
        string,
        Express.Multer.File[]
      >;
      const imagesFiles = Array.isArray(filesMap.images) ? filesMap.images : [];
      const legacyFile = Array.isArray(filesMap.imageUrl)
        ? filesMap.imageUrl[0]
        : undefined;
      const removeImagePublicIds = (() => {
        const raw = (req.body as any).removeImagePublicIds;
        if (!raw) return undefined;
        try {
          const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
          return Array.isArray(arr)
            ? (arr.filter((x) => typeof x === "string") as string[])
            : undefined;
        } catch {
          throw new HttpError(
            400,
            "Invalid JSON format for removeImagePublicIds"
          );
        }
      })();

      const {
        name,
        price,
        stock,
        description,
        size,
        variant,
        category,
        objective,
        color,
        availability,
        // type,
      } = parsedData;

      if (
        !name ||
        price === undefined ||
        stock === undefined ||
        !description ||
        !size ||
        !variant ||
        !category ||
        !objective ||
        !color
      ) {
        throw new HttpError(400, "Semua field wajib diisi");
      }

      const payload: Omit<Product, "id"> = {
        name,
        price,
        stock,
        description,
        size,
        variant,
        category,
        objective,
        color,
        availability,
        // type dihapus karena sudah tidak digunakan
      };

      const updated = await updateProductService(
        req.params.id,
        payload,
        imagesFiles.length ? imagesFiles : legacyFile ? [legacyFile] : [],
        removeImagePublicIds
      );
      return res.status(200).json({
        data: {
          ...updated,
          images: (() => {
            const v = (updated as any).imageUrl;
            if (!v) return [];
            if (Array.isArray(v)) return v;
            if (typeof v === "object" && v.url && v.publicId) return [v];
            if (typeof v === "string") return [{ url: v, publicId: "" }];
            return [];
          })(),
        },
        message: "Product updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/recompute-popular",
  authenticate,
  authorizeAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      invalidatePrefix("popular:v1:");
      invalidatePrefix("recs:v1:");
      invalidatePrefix("recs:v2:");
      return res.status(202).json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
