import {
  createProduct,
  deleteProduct,
  findProductById,
  getAllCategories,
  getAllColors,
  getAllObjectives,
  getAllProducts,
  getProductsCount,
  // getAllTypes,
  updateProduct,
} from "./product.repository";
import { Product, ProductFilter, ImageAsset } from "../types/product";
import {
  deleteImageFromCloudinary,
  uploadImageToCloudinary,
} from "./cloudinary.service";
import { getCachedData, setCachedData } from "../utils/cache";
import prisma from "../lib/prisma";
import { HttpError } from "../utils/http-error";

const normalizeImages = (v: any): ImageAsset[] => {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .filter((x) => x && typeof x === "object" && x.url && x.publicId)
      .map((x) => ({ url: String(x.url), publicId: String(x.publicId) }));
  }
  if (typeof v === "object" && (v as any).url && (v as any).publicId) {
    return [
      { url: String((v as any).url), publicId: String((v as any).publicId) },
    ];
  }
  if (typeof v === "string") {
    return [{ url: v, publicId: "" }];
  }
  return [];
};

export const createProductService = async (
  data: Product,
  files: Express.Multer.File[] | undefined
) => {
  const existing = await getAllProducts({ name: data.name });
  if (existing.length > 0) {
    throw new Error("Product with this name already exists");
  }

  let imageUrl: ImageAsset[] | undefined = undefined;
  if (files && files.length) {
    if (files.length > 5) {
      throw new Error("Maksimum 5 gambar diperbolehkan");
    }
    try {
      const uploads: ImageAsset[] = [];
      for (const f of files) {
        const uploadResult = await uploadImageToCloudinary(f.buffer);
        uploads.push({
          url: uploadResult.secure_url,
          publicId: uploadResult.public_id,
        });
      }
      imageUrl = uploads;
    } catch (error) {
      if (error instanceof Error) {
        console.error("Image upload failed:", error.message);
        throw new Error("Image upload failed: " + error.message);
      }
      throw new Error("Image upload failed: Unknown error");
    }
  }

  const productData = { ...data, imageUrl };
  return await createProduct(productData);
};

export const getAllProductsService = async (filters: ProductFilter = {}) => {
  const MAX_LIMIT = 1000;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const limitRaw = filters.limit && filters.limit > 0 ? filters.limit : 10;
  const limit = Math.min(limitRaw, MAX_LIMIT);

  // Hitung total item sebelum query data untuk akurasi
  const totalItems = await getProductsCount(filters);

  // Jika limit besar atau totalItems <= limit, set satu halaman dan skip=0
  const isSinglePage = totalItems <= limit;
  const skip = isSinglePage ? 0 : (page - 1) * limit;

  const products = await getAllProducts(filters, skip, limit);

  const totalPages = limit > 0 ? Math.ceil(totalItems / limit) || 1 : 1;

  return {
    data: products,
    total: totalItems,
    page: page,
    totalPages: totalPages,
  };
};

export const getProductByIdService = async (id: string) => {
  const product = await findProductById(id);
  if (!product) {
    throw new HttpError(404, "Product not found");
  }
  return product;
};

export const updateProductService = async (
  id: string,
  data: Partial<Product>,
  files: Express.Multer.File[] | undefined,
  removeImagePublicIds?: string[]
) => {
  console.log("sampe service");
  const existing = await findProductById(id);
  if (!existing) throw new HttpError(404, "Product not found");

  // Normalize images from existing
  let images: ImageAsset[] = normalizeImages((existing as any).imageUrl);

  // Remove selected images
  if (removeImagePublicIds && removeImagePublicIds.length) {
    const set = new Set(removeImagePublicIds);
    const toDelete = images.filter((img) => set.has(img.publicId));
    for (const img of toDelete) {
      try {
        if (img.publicId) await deleteImageFromCloudinary(img.publicId);
      } catch (error) {
        console.warn("Failed to delete image from Cloudinary:", error);
      }
    }
    images = images.filter((img) => !set.has(img.publicId));
  }

  // Upload new files
  if (files && files.length) {
    if (images.length + files.length > 5) {
      throw new Error("Total gambar melebihi batas 5");
    }
    try {
      for (const f of files) {
        const uploadResult = await uploadImageToCloudinary(f.buffer);
        images.push({
          url: uploadResult.secure_url,
          publicId: uploadResult.public_id,
        });
      }
    } catch (error) {
      console.error("Image upload failed:", error);
      throw new Error(
        "Image upload failed: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    }
  }

  // Persiapkan data untuk update
  const updatedData: Partial<Product> = {
    ...data,
  };

  // Simpan array gambar ke field Json imageUrl
  // FIX: Menggunakan 'images' secara langsung agar jika kosong tetap terupdate menjadi [] di DB
  updatedData.imageUrl = images;

  // Melakukan update produk di database
  const updated = await updateProduct(id, updatedData);

  return updated;
};

export const deleteProductService = async (id: string) => {
  const existing = await findProductById(id);
  if (!existing) {
    throw new Error("Product not found");
  }
  // Selalu hard delete
  await prisma.orderItem.deleteMany({ where: { productId: id } });

  const images = normalizeImages((existing as any).imageUrl);
  for (const img of images) {
    try {
      if (img.publicId) await deleteImageFromCloudinary(img.publicId);
    } catch (error) {
      console.warn("Failed to delete image from Cloudinary:", error);
    }
  }

  const deleted = await deleteProduct(id);
  return deleted;
};

export const getMetaService = async () => {
  let categories = getCachedData("categories");
  // let types = getCachedData("types");
  let objectives = getCachedData("objectives");
  let colors = getCachedData("colors");

  if (!categories) {
    categories = await getAllCategories();
    setCachedData("categories", categories);
  }

  /*
  if (!types) {
    types = await getAllTypes();
    setCachedData("types", types);
  }
  */

  if (!objectives) {
    objectives = await getAllObjectives();
    setCachedData("objectives", objectives);
  }

  if (!colors) {
    colors = await getAllColors();
    setCachedData("colors", colors);
  }

  // Tambahkan sizes untuk UI: enum konsisten yang digunakan frontend
  const sizes = ["S", "M", "L", "XL", "XXL"];

  return {
    categories,
    // types,
    objectives,
    colors,
    sizes,
  };
};
