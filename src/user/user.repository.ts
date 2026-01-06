import { PrismaClient } from "@prisma/client";
import { UpdateProfileInput } from "../types/user";
import prisma from "../lib/prisma";

export const findUserById = async (userId: string) => {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      photo_profile: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

export const findUserByEmail = async (email: string) => {
  return await prisma.user.findUnique({
    where: { email },
  });
};

export const findUsersByEmails = async (emails: string[]) => {
  if (emails.length === 0) return [];
  return await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, photo_profile: true },
  });
};

export const findUserByUsername = async (username: string) => {
  return await prisma.user.findUnique({
    where: { username },
  });
};

export const updateUserProfile = async (userId: string, data: UpdateProfileInput) => {
  return await prisma.user.update({
    where: { id: userId },
    data: {
      ...data,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      photo_profile: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

export const updateUserPhoto = async (userId: string, photoUrl: string) => {
  return await prisma.user.update({
    where: { id: userId },
    data: {
      photo_profile: photoUrl,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      photo_profile: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

export const deleteUserPhoto = async (userId: string) => {
  return await prisma.user.update({
    where: { id: userId },
    data: {
      photo_profile: null,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      photo_profile: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};
