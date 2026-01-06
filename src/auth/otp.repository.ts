import prisma from "../lib/prisma";

// Runtime enum values are strings; use a union type
export type OtpPurposeType = "REGISTER" | "FORGOT_PASSWORD";

export const createOtpCode = async (
  email: string,
  otpHash: string,
  purpose: OtpPurposeType,
  expiresAt: Date,
) => {
  return prisma.otpCode.create({
    data: {
      email,
      otpHash,
      purpose,
      expiresAt,
    },
  });
};

export const findLatestOtpCode = async (
  email: string,
  purpose: OtpPurposeType,
) => {
  return prisma.otpCode.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: "desc" },
  });
};

export const incrementAttempts = async (id: string) => {
  return prisma.otpCode.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
};

export const setLockoutUntil = async (id: string, until: Date) => {
  return prisma.otpCode.update({
    where: { id },
    data: { lockedUntil: until },
  });
};

export const deleteOtpCodesFor = async (
  email: string,
  purpose: OtpPurposeType,
) => {
  return prisma.otpCode.deleteMany({ where: { email, purpose } });
};

export default {
  createOtpCode,
  findLatestOtpCode,
  incrementAttempts,
  setLockoutUntil,
  deleteOtpCodesFor,
};