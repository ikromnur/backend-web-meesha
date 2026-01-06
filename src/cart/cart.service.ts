import {
  findCartByUserId,
  findCartItemById,
  findCartByUserAndProduct,
  addToCart,
  updateCartQuantity,
  deleteCartItem,
  clearUserCart,
} from "./cart.repository";
import { AddToCartInput, UpdateCartInput, CartSummary } from "../types/cart";
import { HttpError } from "../utils/http-error";
import prisma from "../lib/prisma";

export const getUserCartService = async (
  userId: string
): Promise<CartSummary> => {
  try {
    console.log("[CART SERVICE] Getting cart for user:", userId);

    const cartItems = await findCartByUserId(userId);

    const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cartItems.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );

    console.log(
      "[CART SERVICE] Cart retrieved successfully. Items:",
      cartItems.length
    );

    return {
      items: cartItems,
      totalItems,
      totalPrice,
    };
  } catch (error) {
    console.error("[CART SERVICE] Error getting cart:", error);
    throw error;
  }
};

export const addToCartService = async (
  userId: string,
  data: AddToCartInput
) => {
  try {
    console.log("[CART SERVICE] Adding to cart:", { userId, ...data });

    // Validate product exists and has stock
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      throw new HttpError(404, "Product not found");
    }

    if (product.stock < data.quantity) {
      throw new HttpError(400, `Not enough stock. Available: ${product.stock}`);
    }

    // Check if item already exists in cart
    const existingCartItem = await findCartByUserAndProduct(
      userId,
      data.productId,
      data.size
    );

    if (existingCartItem) {
      // Update quantity if already exists
      const newQuantity = existingCartItem.quantity + data.quantity;

      if (product.stock < newQuantity) {
        throw new HttpError(
          400,
          `Not enough stock. Available: ${product.stock}, in cart: ${existingCartItem.quantity}`
        );
      }

      console.log(
        "[CART SERVICE] Item exists, updating quantity to:",
        newQuantity
      );
      const updatedItem = await updateCartQuantity(
        existingCartItem.id,
        userId,
        newQuantity
      );

      return updatedItem;
    }

    // Add new item to cart
    console.log("[CART SERVICE] Adding new item to cart");
    const cartItem = await addToCart(userId, data);

    console.log("[CART SERVICE] Item added successfully");
    return cartItem;
  } catch (error) {
    console.error("[CART SERVICE] Error adding to cart:", error);
    throw error;
  }
};

export const updateCartItemService = async (
  cartId: string,
  userId: string,
  data: UpdateCartInput
) => {
  try {
    console.log("[CART SERVICE] Updating cart item:", {
      cartId,
      userId,
      quantity: data.quantity,
      size: data.size,
    });

    // Validate cart item exists and belongs to user
    const cartItem = await findCartItemById(cartId, userId);

    if (!cartItem) {
      throw new HttpError(404, "Cart item not found");
    }

    // Determine desired quantity (if not provided, keep current)
    const desiredQuantity =
      typeof data.quantity === "number" ? data.quantity : cartItem.quantity;

    // Validate quantity
    if (desiredQuantity < 1) {
      throw new HttpError(400, "Quantity must be at least 1");
    }

    // Normalize and validate size if provided
    let newSize: string | null = cartItem.size as any; // keep current by default
    if (typeof data.size === "string") {
      const normalized = data.size.toUpperCase();
      const allowedSizes = ["S", "M", "L", "XL", "XXL"];
      if (!allowedSizes.includes(normalized)) {
        throw new HttpError(
          400,
          "Size format tidak valid. Diterima hanya: S, M, L, XL, XXL"
        );
      }
      newSize = normalized as any;
    }

    // If size changes, we may need to merge with an existing cart item
    if ((cartItem.size as any) !== newSize && newSize !== undefined) {
      const potentialTarget = await findCartByUserAndProduct(
        userId,
        cartItem.productId,
        newSize as any
      );

      if (potentialTarget && potentialTarget.id !== cartId) {
        // Merge quantities and delete the other item, then update current
        const mergedQuantity = desiredQuantity + potentialTarget.quantity;

        // Validate stock against merged quantity
        if (cartItem.product.stock < mergedQuantity) {
          throw new HttpError(
            400,
            `Not enough stock. Available: ${cartItem.product.stock}`
          );
        }

        // Delete the other item, then update current with new size and merged quantity
        await deleteCartItem(potentialTarget.id, userId);
        const updatedMerged = await prisma.cart.update({
          where: { id: cartId },
          data: {
            quantity: mergedQuantity,
            size: newSize as any,
            updatedAt: new Date(),
          },
          include: {
            product: {
              include: {
                category: { select: { id: true, name: true, key: true } },
                color: { select: { id: true, name: true, key: true } },
                objective: { select: { id: true, name: true, key: true } },
              },
            },
          },
        });

        console.log("[CART SERVICE] Cart item merged and updated successfully");
        return updatedMerged;
      }
    }

    // Validate stock for desired quantity alone
    if (cartItem.product.stock < desiredQuantity) {
      throw new HttpError(
        400,
        `Not enough stock. Available: ${cartItem.product.stock}`
      );
    }

    // Update quantity and/or size on the same item
    const updatedItem = await prisma.cart.update({
      where: { id: cartId },
      data: {
        quantity: desiredQuantity,
        ...(typeof data.size === "string" ? { size: newSize as any } : {}),
        updatedAt: new Date(),
      },
      include: {
        product: {
          include: {
            category: { select: { id: true, name: true, key: true } },
            color: { select: { id: true, name: true, key: true } },
            objective: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });

    console.log("[CART SERVICE] Cart item updated successfully");
    return updatedItem;
  } catch (error) {
    console.error("[CART SERVICE] Error updating cart item:", error);
    throw error;
  }
};

export const deleteCartItemService = async (cartId: string, userId: string) => {
  try {
    console.log("[CART SERVICE] Deleting cart item:", { cartId, userId });

    // Validate cart item exists and belongs to user
    const cartItem = await findCartItemById(cartId, userId);

    if (!cartItem) {
      throw new HttpError(404, "Cart item not found");
    }

    await deleteCartItem(cartId, userId);

    console.log("[CART SERVICE] Cart item deleted successfully");
  } catch (error) {
    console.error("[CART SERVICE] Error deleting cart item:", error);
    throw error;
  }
};

export const clearCartService = async (userId: string) => {
  try {
    console.log("[CART SERVICE] Clearing cart for user:", userId);

    await clearUserCart(userId);

    console.log("[CART SERVICE] Cart cleared successfully");
  } catch (error) {
    console.error("[CART SERVICE] Error clearing cart:", error);
    throw error;
  }
};

export default {
  getUserCartService,
  addToCartService,
  updateCartItemService,
  deleteCartItemService,
  clearCartService,
};
