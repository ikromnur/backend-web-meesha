import { User } from "../types/user";
import prisma from "../lib/prisma";

export const createUser = async (userData: User) => {
  const user = await prisma.user.create({
    data: {
      username: userData.username,
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      password: userData.password,
      role: userData.role,
      isVerified: userData.isVerified ?? false,
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      photo_profile: true,
      isVerified: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
};

export const findUserById = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });
  return user;
};

export const findUserByEmail = async (email: string) => {
  // Setelah migrasi, kolom isVerified dan passwordResetWindowUntil sudah ada
  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      password: true,
      role: true,
      photo_profile: true,
      phone: true,
      isVerified: true,
      passwordResetWindowUntil: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return user;
};

export const updateUserPassword = async (
  email: string,
  newPasswordHash: string,
) => {
  return await prisma.user.update({
    where: { email },
    data: {
      password: newPasswordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });
};

export const updateUserResetToken = async (
  email: string,
  resetToken: string,
  expiryDate: Date,
) => {
  return await prisma.user.update({
    where: { email },
    data: {
      passwordResetToken: resetToken,
      passwordResetExpires: expiryDate,
    },
  });
};

export default {
  createUser,
  findUserById,
  findUserByEmail,
  updateUserPassword,
  updateUserResetToken,
};
