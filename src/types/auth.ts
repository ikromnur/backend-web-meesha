import { z } from "zod";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, { message: "Username must be at least 3 characters long" })
    .optional(),
  name: z
    .string()
    .min(3, { message: "Name must be at least 3 characters long" }),
  email: z.string().email({ message: "Invalid email address" }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, and one number",
    }),
  phone: z.string().optional(),
});

export type RegisterUserInput = z.infer<typeof registerSchema>;

export const requestOtpSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
});

// Unified purpose support for OTP flows
export const otpPurposeSchema = z.enum([
  "register",
  "forgot-password",
  "change-password",
]);

export const requestOtpUnifiedSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  purpose: otpPurposeSchema,
});

export const resetPasswordSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  otp: z.string().length(6, { message: "OTP must be 6 characters long" }).optional(),
  newPassword: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, and one number",
    }),
});

export const verifyRegisterSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  otp: z.string().length(6, { message: "OTP must be 6 characters long" }),
});

export type VerifyRegisterInput = z.infer<typeof verifyRegisterSchema>;

export const verifyOtpUnifiedSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  otp: z.string().length(6, { message: "OTP must be 6 characters long" }),
  purpose: otpPurposeSchema,
});

export type RequestOtpUnifiedInput = z.infer<typeof requestOtpUnifiedSchema>;
export type VerifyOtpUnifiedInput = z.infer<typeof verifyOtpUnifiedSchema>;
