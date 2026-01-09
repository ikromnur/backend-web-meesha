import { Role, User } from "../types/user";
import { RegisterUserInput } from "../types/auth";
import bcrypt from "bcrypt";
import {
  createUser,
  findUserByEmail,
  updateUserPassword,
  updateUserResetToken,
} from "./auth.repository";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import emailService from "../utils/email.utils";
import { HttpError } from "../utils/http-error";
import {
  createOtpCode,
  findLatestOtpCode,
  incrementAttempts,
  setLockoutUntil,
  deleteOtpCodesFor,
  OtpPurposeType,
} from "./otp.repository";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const SALT_ROUNDS = 10;
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 6);
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_RESEND_COOLDOWN_SECONDS = Number(
  process.env.OTP_RESEND_COOLDOWN_SECONDS || 120
);
const OTP_LOCKOUT_MINUTES = Number(process.env.OTP_LOCKOUT_MINUTES || 15);
const OTP_DISABLE_COOLDOWN = process.env.OTP_DISABLE_COOLDOWN === "true";

const createUserService = async (userData: RegisterUserInput) => {
  try {
    console.log("[AUTH SERVICE] Creating user:", userData.email);
    const existingUser = await findUserByEmail(userData.email);

    if (existingUser) {
      console.log("[AUTH SERVICE] Email already exists:", userData.email);
      throw new HttpError(400, "Email is already registered");
    }

    console.log("[AUTH SERVICE] Hashing password...");
    const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);

    const userWithDefaults: User = {
      username: userData.username,
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      password: hashedPassword,
      role: Role.USER, // Always assign USER role on creation
      isVerified: false,
    };

    console.log("[AUTH SERVICE] Saving user to database...");
    const user = await createUser(userWithDefaults);
    console.log("[AUTH SERVICE] User created successfully:", user.id);
    return user;
  } catch (error) {
    console.error("[AUTH SERVICE] Error creating user:", error);
    throw error;
  }
};

export const loginUserService = async (email: string, password: string) => {
  try {
    console.log("[AUTH SERVICE] Login attempt for:", email);
    const user = await findUserByEmail(email);
    if (!user) {
      console.log("[AUTH SERVICE] User not found:", email);
      throw new HttpError(401, "Invalid email or password");
    }

    console.log("[AUTH SERVICE] Verifying password...");
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      console.log("[AUTH SERVICE] Invalid password for:", email);
      throw new HttpError(401, "Invalid email or password");
    }

    // Block login until verified for new accounts
    if (typeof (user as any).isVerified !== "undefined") {
      if (!(user as any).isVerified) {
        throw new HttpError(
          403,
          "Account not verified. Please complete OTP verification."
        );
      }
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      photo_profile: user.photo_profile,
    };

    console.log("[AUTH SERVICE] Generating JWT token...");
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: "7d",
    });

    const { password: _pw, ...safeUser } = user;
    console.log("[AUTH SERVICE] Login successful for:", email);
    return { user: safeUser, token };
  } catch (error) {
    console.error("[AUTH SERVICE] Error during login:", error);
    throw error;
  }
};

export const requestPasswordResetService = async (email: string) => {
  try {
    console.log("[AUTH SERVICE] Password reset requested for:", email);
    const user = await findUserByEmail(email);
    if (!user) {
      // We don't want to reveal if an email is registered or not
      // So we send a success-like response but do nothing.
      console.log(
        "[AUTH SERVICE] Password reset requested for non-existent email:",
        email
      );
      return;
    }

    // Use Bravo-based OTP codes using canonical email
    await sendOtpForPurpose(user.email, "FORGOT_PASSWORD");
  } catch (error) {
    console.error("[AUTH SERVICE] Error in password reset request:", error);
    throw error;
  }
};

export const resetPasswordService = async (
  email: string,
  otp: string | undefined,
  newPassword: string
) => {
  try {
    console.log("[AUTH SERVICE] Password reset attempt for:", email);

    if (!otp) {
      throw new HttpError(400, "OTP wajib diisi untuk mereset password.");
    }

    const user = await findUserByEmail(email);
    if (!user) throw new HttpError(404, "User not found.");

    const canonicalEmail = user.email;

    // Verify OTP via Bravo-based storage
    await verifyOtpForPurpose(canonicalEmail, otp, "FORGOT_PASSWORD");

    // Confirm reset window
    const windowUntil = (user as any).passwordResetWindowUntil as Date | null;
    if (!windowUntil || windowUntil < new Date()) {
      throw new HttpError(400, "Password reset window has expired.");
    }

    console.log("[AUTH SERVICE] Hashing new password...");
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    console.log("[AUTH SERVICE] Updating password in database...");
    await updateUserPassword(canonicalEmail, hashedPassword);

    // Cleanup OTP codes after successful reset
    await deleteOtpCodesFor(canonicalEmail, "FORGOT_PASSWORD");

    console.log(
      "[AUTH SERVICE] Password reset successful for:",
      canonicalEmail
    );
  } catch (error) {
    console.error("[AUTH SERVICE] Error resetting password:", error);
    throw error;
  }
};

// ===== OTP core (Brevo via Email) =====
const randomOtp = (length: number) => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return crypto.randomInt(min, max).toString();
};

export const sendOtpForPurpose = async (
  email: string,
  purpose: OtpPurposeType
) => {
  const user = await findUserByEmail(email);
  if (!user) throw new HttpError(404, "User not found");

  const canonicalEmail = user.email;

  // Check lockout
  const latest = await findLatestOtpCode(canonicalEmail, purpose);
  if (latest?.lockedUntil && latest.lockedUntil > new Date()) {
    const minutes = Math.ceil(
      (latest.lockedUntil.getTime() - Date.now()) / 60000
    );
    throw new HttpError(
      429,
      `Too many attempts. Try again in ${minutes} minutes.`
    );
  }

  // Cooldown
  if (!OTP_DISABLE_COOLDOWN) {
    if (
      latest &&
      latest.createdAt >
        new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000)
    ) {
      const secondsLeft = Math.ceil(
        (latest.createdAt.getTime() +
          OTP_RESEND_COOLDOWN_SECONDS * 1000 -
          Date.now()) /
          1000
      );
      throw new HttpError(
        429,
        `Please wait ${secondsLeft}s before requesting another OTP.`
      );
    }
  }

  const code = randomOtp(OTP_LENGTH);
  const otpHash = await bcrypt.hash(code, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000);

  await createOtpCode(canonicalEmail, otpHash, purpose, expiresAt);

  // Kirim OTP via email menggunakan Brevo (SMTP)
  // try-catch removed to propagate errors to controller (so frontend knows it failed)
  if (purpose === "REGISTER") {
    await emailService.sendVerificationOtp(
      canonicalEmail,
      code,
      OTP_TTL_MINUTES
    );
  } else {
    await emailService.sendPasswordResetOtp(canonicalEmail, code);
  }

  // For forgot-password, set reset window until TTL
  if (purpose === "FORGOT_PASSWORD") {
    // update window until on user
    await updateUserResetToken(canonicalEmail, "", expiresAt); // legacy fields not used but maintained
    // direct field update for window until
    // use prisma directly to avoid adding repo function
    const prisma = (await import("../lib/prisma")).default;
    await prisma.user.update({
      where: { email: canonicalEmail },
      data: { passwordResetWindowUntil: expiresAt } as any,
    });
  }
};

export const verifyOtpForPurpose = async (
  email: string,
  otp: string,
  purpose: OtpPurposeType
) => {
  // Ensure we use the canonical email from DB to avoid case mismatch
  const user = await findUserByEmail(email);
  if (!user) throw new HttpError(404, "User not found.");

  const canonicalEmail = user.email;

  const record = await findLatestOtpCode(canonicalEmail, purpose);
  if (!record)
    throw new HttpError(404, "No OTP found. Please request a new one.");

  if (record.lockedUntil && record.lockedUntil > new Date()) {
    throw new HttpError(429, "Too many attempts. Try later.");
  }
  if (record.expiresAt < new Date()) {
    throw new HttpError(400, "OTP expired. Please request a new one.");
  }

  const ok = await bcrypt.compare(otp, record.otpHash);
  if (!ok) {
    await incrementAttempts(record.id);
    const attempts = record.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      const until = new Date(Date.now() + OTP_LOCKOUT_MINUTES * 60000);
      await setLockoutUntil(record.id, until);
    }
    throw new HttpError(401, "Invalid OTP.");
  }

  // Success: apply effect
  const prisma = (await import("../lib/prisma")).default;
  if (purpose === "REGISTER") {
    await prisma.user.update({
      where: { email: canonicalEmail },
      data: { isVerified: true } as any,
    });
  }
  if (purpose === "FORGOT_PASSWORD") {
    const windowUntil = new Date(Date.now() + OTP_TTL_MINUTES * 60000);
    await prisma.user.update({
      where: { email: canonicalEmail },
      data: { passwordResetWindowUntil: windowUntil } as any,
    });
    // NOTE: We do NOT delete OTP here for FORGOT_PASSWORD.
    // It must be retained so resetPasswordService can verify it again.
    // resetPasswordService will delete it after successful password change.
  } else {
    // cleanup existing codes to prevent reuse for other purposes (e.g. REGISTER)
    await deleteOtpCodesFor(canonicalEmail, purpose);
  }
};

export default {
  createUserService,
  loginUserService,
  requestPasswordResetService,
  resetPasswordService,
  sendOtpForPurpose,
  verifyOtpForPurpose,
};
