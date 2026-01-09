import { Router, Request, Response } from "express";
import {
  getUserCartService,
  addToCartService,
  updateCartItemService,
  deleteCartItemService,
  clearCartService,
} from "./cart.service";
import { authenticate } from "../middleware/auth.middleware";
import { AddToCartInput, UpdateCartInput } from "../types/cart";

const router = Router();

// Helper: ambil URL gambar utama dari product.imageUrl (Json beragam bentuk)
const resolveImageMain = (imageUrl: any): string => {
  try {
    if (!imageUrl) return "";
    if (Array.isArray(imageUrl)) {
      const first = imageUrl[0];
      if (!first) return "";
      if (typeof first === "string") return String(first);
      if (typeof first === "object")
        return String(first.url || first.secure_url || "");
    }
    if (typeof imageUrl === "object")
      return String(imageUrl.url || (imageUrl as any).secure_url || "");
    if (typeof imageUrl === "string") return imageUrl;
  } catch {}
  return "";
};

// Helper: normalisasi ke array images: { url, publicId }
const normalizeImages = (v: any): Array<{ url: string; publicId: string }> => {
  try {
    if (!v) return [];
    if (Array.isArray(v)) {
      return v
        .map((x) => {
          if (typeof x === "string") return { url: String(x), publicId: "" };
          if (x && typeof x === "object")
            return {
              url: String((x as any).url || (x as any).secure_url || ""),
              publicId: String((x as any).publicId || (x as any).public_id || ""),
            };
          return undefined as any;
        })
        .filter((x: any) => x && x.url);
    }
    if (typeof v === "object") {
      const url = String((v as any).url || (v as any).secure_url || "");
      const publicId = String((v as any).publicId || (v as any).public_id || "");
      return url ? [{ url, publicId }] : [];
    }
    if (typeof v === "string") return [{ url: v, publicId: "" }];
  } catch {}
  return [];
};

/**
 * @route   GET /api/carts
 * @desc    Get user's cart with all items
 * @access  Private
 */
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    console.log("[CART CONTROLLER] GET /carts - User:", req.user?.userId);

    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    const cart = await getUserCartService(userId);

    // Perkaya bentuk respons + normalisasi angka agar UI aman dari NaN
    const itemsEnriched = (cart.items || []).map((it: any) => {
      const qtyRaw = it?.quantity;
      const qty =
        typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw) || 0;
      const priceRaw = it?.product?.price;
      const unitPrice =
        typeof priceRaw === "number" ? priceRaw : Number(priceRaw) || 0;
      const subtotal = unitPrice * qty;

      return {
        ...it,
        quantity: qty,
        unitPrice,
        subtotal,
        product: {
          ...it.product,
          imageMain: resolveImageMain(it.product?.imageUrl),
          images: normalizeImages(it.product?.imageUrl),
        },
      };
    });

    const totalItems = itemsEnriched.reduce((sum: number, x: any) => sum + (typeof x.quantity === "number" ? x.quantity : 0), 0);
    const totalPrice = itemsEnriched.reduce((sum: number, x: any) => sum + (typeof x.subtotal === "number" ? x.subtotal : 0), 0);

    const enriched = {
      totalItems,
      totalPrice,
      items: itemsEnriched,
    };

    return res.status(200).json({
      success: true,
      message: "Cart retrieved successfully",
      data: enriched,
      items: itemsEnriched,
      totalItems,
      totalPrice,
    });
  } catch (error: any) {
    console.error("[CART CONTROLLER] Error getting cart:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to get cart",
    });
  }
});

/**
 * @route   POST /api/carts
 * @desc    Add item to cart
 * @access  Private
 */
router.post("/", authenticate, async (req: Request, res: Response) => {
  try {
    console.log("[CART CONTROLLER] POST /carts - Body:", req.body);

    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    // Accept both productId (BE) and product_id (FE)
    const body: any = req.body || {};
    const productId: string = body.productId || body.product_id;
    let quantity: number = body.quantity;
    let size: string | undefined = body.size;

    // Default quantity to 1 if not provided
    if (quantity === undefined || quantity === null) {
      quantity = 1;
    }

    // Normalize size to uppercase if provided (S,M,L,XL,XXL)
    const allowedSizes = ["S", "M", "L", "XL", "XXL"];
    if (typeof size === "string") {
      size = size.toUpperCase();
      if (!allowedSizes.includes(size)) {
        return res.status(400).json({
          success: false,
          message:
            "Size format tidak valid. Diterima hanya: S, M, L, XL, XXL",
        });
      }
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Validation
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    // Prevent invalid ID like 'NaN' or non-UUID strings
    if (typeof productId !== "string" || productId.toLowerCase() === "nan") {
      return res.status(400).json({
        success: false,
        message: "Product ID must be a valid UUID string",
      });
    }
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({
        success: false,
        message: "Product ID format tidak valid (harus UUID)",
      });
    }

    if (typeof quantity !== "number" || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

  const cartItem = await addToCartService(userId, {
    productId,
    quantity,
    size,
  });

    // Perkaya respons satu item + normalisasi angka (unitPrice/subtotal)
    const priceRaw = (cartItem as any)?.product?.price;
    const unitPrice =
      typeof priceRaw === "number" ? priceRaw : Number(priceRaw) || 0;
    const qtyRaw = (cartItem as any)?.quantity;
    const qty =
      typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw) || 0;
    const subtotal = unitPrice * qty;

    const enrichedItem = {
      ...cartItem,
      unitPrice,
      subtotal,
      quantity: qty,
      product: {
        ...cartItem.product,
        imageMain: resolveImageMain(cartItem.product?.imageUrl),
        images: normalizeImages(cartItem.product?.imageUrl),
      },
    } as any;

    return res.status(201).json({
      success: true,
      message: "Item added to cart successfully",
      data: enrichedItem,
    });
  } catch (error: any) {
    console.error("[CART CONTROLLER] Error adding to cart:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to add item to cart",
    });
  }
});

/**
 * @route   PUT /api/carts/:id
 * @desc    Update cart item quantity
 * @access  Private
 */
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const cartId = req.params.id;
    const userId = req.user?.userId;

    console.log("[CART CONTROLLER] PUT /carts/:id - CartID:", cartId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    // Validate cartId format to catch 'NaN' or non-UUID values early
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!cartId || cartId.toLowerCase() === "nan" || !uuidRegex.test(cartId)) {
      return res.status(400).json({
        success: false,
        message: "Cart ID format tidak valid (harus UUID)",
      });
    }

    const { quantity, size }: UpdateCartInput = req.body;

    // Validation: at least one of quantity or size must be provided
    if (quantity === undefined && size === undefined) {
      return res.status(400).json({
        success: false,
        message: "Provide quantity and/or size to update",
      });
    }

    // Validate quantity if provided
    if (quantity !== undefined && (typeof quantity !== "number" || quantity < 1)) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    // Validate size if provided
    if (typeof size === "string") {
      const allowedSizes = ["S", "M", "L", "XL", "XXL"];
      const normalized = size.toUpperCase();
      if (!allowedSizes.includes(normalized)) {
        return res.status(400).json({
          success: false,
          message: "Size format tidak valid. Diterima hanya: S, M, L, XL, XXL",
        });
      }
    }

  const updatedItem = await updateCartItemService(cartId, userId, {
    quantity,
    size,
  });

    const priceRaw = (updatedItem as any)?.product?.price;
    const unitPrice =
      typeof priceRaw === "number" ? priceRaw : Number(priceRaw) || 0;
    const qtyRaw = (updatedItem as any)?.quantity;
    const qty =
      typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw) || 0;
    const subtotal = unitPrice * qty;

    const enrichedItem = {
      ...updatedItem,
      unitPrice,
      subtotal,
      quantity: qty,
      product: {
        ...updatedItem.product,
        imageMain: resolveImageMain(updatedItem.product?.imageUrl),
        images: normalizeImages(updatedItem.product?.imageUrl),
      },
    } as any;

    return res.status(200).json({
      success: true,
      message: "Cart item updated successfully",
      data: enrichedItem,
    });
  } catch (error: any) {
    console.error("[CART CONTROLLER] Error updating cart item:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to update cart item",
    });
  }
});

/**
 * @route   DELETE /api/carts/:id
 * @desc    Remove item from cart
 * @access  Private
 */
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const cartId = req.params.id;
    const userId = req.user?.userId;

    console.log("[CART CONTROLLER] DELETE /carts/:id - CartID:", cartId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    // Validate cartId format to catch 'NaN' or non-UUID values early
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!cartId || cartId.toLowerCase() === "nan" || !uuidRegex.test(cartId)) {
      return res.status(400).json({
        success: false,
        message: "Cart ID format tidak valid (harus UUID)",
      });
    }

    await deleteCartItemService(cartId, userId);

    return res.status(200).json({
      success: true,
      message: "Item removed from cart successfully",
    });
  } catch (error: any) {
    console.error("[CART CONTROLLER] Error deleting cart item:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to remove item from cart",
    });
  }
});

/**
 * @route   DELETE /api/carts
 * @desc    Clear all items from cart
 * @access  Private
 */
router.delete("/", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    console.log("[CART CONTROLLER] DELETE /carts - Clear cart for user:", userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    await clearCartService(userId);

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
    });
  } catch (error: any) {
    console.error("[CART CONTROLLER] Error clearing cart:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to clear cart",
    });
  }
});

/**
 * @route   POST /api/carts/clear
 * @desc    Alias: Clear all items from cart (gunakan POST untuk kompatibilitas proxy)
 * @access  Private
 */
router.post("/clear", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    console.log("[CART CONTROLLER] POST /carts/clear - Clear cart for user:", userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    await clearCartService(userId);

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
    });
  } catch (error: any) {
    console.error("[CART CONTROLLER] Error clearing cart (POST /clear):", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to clear cart",
    });
  }
});

export default router;
