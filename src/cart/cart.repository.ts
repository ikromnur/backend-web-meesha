import { PrismaClient } from "@prisma/client";
import { Cart, AddToCartInput } from "../types/cart";
import prisma from "../lib/prisma";

export const findCartByUserId = async (userId: string) => {
  return await prisma.cart.findMany({
    where: { userId },
    include: {
      product: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
          color: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
          objective: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

export const findCartItemById = async (cartId: string, userId: string) => {
  return await prisma.cart.findFirst({
    where: {
      id: cartId,
      userId: userId,
    },
    include: {
      product: true,
    },
  });
};

export const findCartByUserAndProduct = async (
  userId: string,
  productId: string,
  size?: string
) => {
  return await prisma.cart.findFirst({
    where: {
      userId,
      productId,
      size: (size as any) || null,
    },
  });
};

export const addToCart = async (userId: string, data: AddToCartInput) => {
  return await prisma.cart.create({
    data: {
      userId,
      productId: data.productId,
      quantity: data.quantity,
      size: (data.size as any) || null,
    },
    include: {
      product: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
          color: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
          objective: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
        },
      },
    },
  });
};

export const updateCartQuantity = async (
  cartId: string,
  userId: string,
  quantity: number
) => {
  return await prisma.cart.update({
    where: {
      id: cartId,
      userId: userId,
    },
    data: {
      quantity,
      updatedAt: new Date(),
    },
    include: {
      product: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
          color: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
          objective: {
            select: {
              id: true,
              name: true,
              key: true,
            },
          },
        },
      },
    },
  });
};

export const deleteCartItem = async (cartId: string, userId: string) => {
  return await prisma.cart.delete({
    where: {
      id: cartId,
      userId: userId,
    },
  });
};

export const clearUserCart = async (userId: string) => {
  return await prisma.cart.deleteMany({
    where: { userId },
  });
};

export default {
  findCartByUserId,
  findCartItemById,
  findCartByUserAndProduct,
  addToCart,
  updateCartQuantity,
  deleteCartItem,
  clearUserCart,
};
