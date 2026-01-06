import { Product, ProductFilter } from "../types/product";
import prisma from "../lib/prisma";
import { Size } from "@prisma/client";

// Helper untuk membangun where Prisma dari ProductFilter
const buildWhereFromFilters = (filters: ProductFilter = {}) => {
  const where: any = {};

  // Pencarian di name atau description (case-insensitive)
  if (filters.search && filters.search.trim() !== "") {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  if (filters.name) {
    where.name = { equals: filters.name };
  }

  if (filters.category && filters.category.length > 0) {
    where.category = { key: { in: filters.category } };
  }

  if (filters.objective && filters.objective.length > 0) {
    where.objective = { key: { in: filters.objective } };
  }

  if (filters.color && filters.color.length > 0) {
    where.color = { key: { in: filters.color } };
  }

  if (filters.size && filters.size.length > 0) {
    where.size = { in: filters.size as Size[] };
  }

  // Availability enum filter
  if (filters.availability && filters.availability.length > 0) {
    where.availability = { in: filters.availability };
  }

  if (
    filters.price &&
    (filters.price.gte !== undefined || filters.price.lte !== undefined)
  ) {
    where.price = {
      ...(filters.price.gte !== undefined && { gte: filters.price.gte }),
      ...(filters.price.lte !== undefined && { lte: filters.price.lte }),
    };
  }

  // Secara default, sembunyikan produk yang di-soft-delete
  // Soft-delete tidak dipakai lagi; tidak perlu filter deletedAt

  return where;
};

export const createProduct = async (data: Product) => {
  // Ensure objective and color exist (upsert by key) before connecting
  await prisma.objective.upsert({
    where: { key: data.objective.key },
    update: { name: data.objective.name },
    create: {
      id: data.objective.id,
      key: data.objective.key,
      name: data.objective.name,
    },
  });

  await prisma.color.upsert({
    where: { key: data.color.key },
    update: { name: data.color.name },
    create: {
      id: data.color.id,
      key: data.color.key,
      name: data.color.name,
    },
  });

  return await prisma.product.create({
    data: {
      name: data.name,
      price: data.price,
      stock: data.stock,
      description: data.description,
      imageUrl: data.imageUrl,
      availability: (data as any).availability ?? "READY",
      size: data.size as Size,
      variant: data.variant,
      category: {
        connect: { key: data.category.key },
      },
      objective: {
        connect: { key: data.objective.key },
      },
      color: {
        connect: { key: data.color.key },
      },
    } as any,
  });
};

export const getAllProducts = async (
  filters: ProductFilter = {},
  skip?: number,
  take?: number
) => {
  const where = buildWhereFromFilters(filters);

  const products = await prisma.product.findMany({
    where,
    include: {
      category: {
        select: { id: true, key: true, name: true },
      },
      objective: {
        select: { id: true, key: true, name: true },
      },
      color: {
        select: { id: true, key: true, name: true },
      },
    },
    ...(typeof skip === "number" ? { skip } : {}),
    ...(typeof take === "number" ? { take } : {}),
    orderBy: {
      createdAt: "desc",
    },
  });

  const transformedProducts = products.map(
    ({ categoryId, objectiveId, colorId, ...rest }) => rest
  );
  return transformedProducts;
};

export const getProductsCount = async (filters: ProductFilter = {}) => {
  const where = buildWhereFromFilters(filters);
  const total = await prisma.product.count({ where });
  return total;
};

export const findProductById = async (id: string) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: {
        select: { key: true, name: true },
      },
      objective: {
        select: { key: true, name: true },
      },
      color: {
        select: { key: true, name: true },
      },
      ratings: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          comment: true,
          reply: true,
          replyAt: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              username: true,
              photo_profile: true,
            },
          },
        },
      },
    },
  });

  if (!product) return null;

  // Destructure untuk menghapus ID foreign keys
  const { categoryId, objectiveId, colorId, ...cleanedProduct } = product;

  return cleanedProduct;
};

export const deleteProduct = async (id: string) => {
  // Hard delete: benar-benar menghapus row Product
  return await prisma.product.delete({ where: { id } });
};

export const updateProduct = async (id: string, data: Partial<Product>) => {
  return await prisma.product.update({
    where: { id },
    data: {
      ...data,
      availability: (data as any).availability ?? undefined,
      size: data.size as Size | undefined,
      category: data.category?.key
        ? { connect: { key: data.category.key } }
        : undefined,
      objective: data.objective?.key
        ? { connect: { key: data.objective.key } }
        : undefined,
      color: data.color?.key ? { connect: { key: data.color.key } } : undefined,
    } as any,
  });
};

export const getAllCategories = () => prisma.category.findMany();
// export const getAllTypes = () => prisma.type.findMany();
export const getAllObjectives = () => prisma.objective.findMany();
export const getAllColors = () => prisma.color.findMany();
