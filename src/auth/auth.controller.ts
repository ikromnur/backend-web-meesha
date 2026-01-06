import "dotenv/config";
import express from "express";
import authService from "./auth.service";
import { ZodError } from "zod";
import {
  registerSchema,
  requestOtpSchema,
  requestOtpUnifiedSchema,
  resetPasswordSchema,
  verifyRegisterSchema,
  verifyOtpUnifiedSchema,
} from "../types/auth";
// Use string enum values for OtpPurpose
import { authenticate } from "../middleware/auth.middleware";
import { upload } from "../middleware/upload.middleware";
import { findUserById } from "./auth.repository";
import { v2 as cloudinary } from "cloudinary";
import { HttpError } from "../utils/http-error";
import { OtpPurposeType } from "./otp.repository";
import prisma from "../lib/prisma";

// Configure Cloudinary (ensure env loaded)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = express.Router();

// Updated /register endpoint with validation
router.post("/register", async (req, res, next) => {
  try {
    console.log("[REGISTER] Request received");
    const newUserData = registerSchema.parse(req.body);
    console.log("[REGISTER] Validation passed for email:", newUserData.email);

    const user = await authService.createUserService(newUserData);
    console.log("[REGISTER] User created successfully:", user.id);

    // Send OTP for account verification via Brevo (email)
    try {
      await authService.sendOtpForPurpose(user.email, "REGISTER");
      console.log("[REGISTER] OTP sent for verification to:", user.email);
    } catch (otpErr: any) {
      console.warn("[REGISTER] Failed to send OTP:", otpErr?.message || otpErr);
    }

    res.status(201).json({
      success: true,
      data: user,
      message:
        "User berhasil dibuat. OTP verifikasi telah dikirim ke email. Jika belum menerima, silakan minta ulang OTP melalui endpoint /api/auth/request-otp-register.",
    });
  } catch (error) {
    console.error("[REGISTER] Error:", error);
    if (error instanceof ZodError) {
      console.error("[REGISTER] Validation error:", error.issues);
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
    }
    next(error);
  }
});

import normalizeUser from "../utils/normalize-user";

router.post("/login", async (req, res, next) => {
  try {
    console.log("[LOGIN] Request received");
    const { email, password } = req.body;

    if (!email || !password) {
      console.error("[LOGIN] Missing email or password");
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }

    const { user, token } = await authService.loginUserService(email, password);
    console.log("[LOGIN] Login successful for user:", email);
    res.status(200).json({
      success: true,
      data: normalizeUser(user),
      token,
      message: "Login successful",
    });
  } catch (error: any) {
    console.error("[LOGIN] Error:", error.message);
    if (error instanceof HttpError) {
      const code = error.status === 403 ? "USER_NOT_VERIFIED" : "CREDENTIALS_INVALID";
      return res.status(error.status).json({
        success: false,
        code,
        message: error.message,
      });
    }
    next(error);
  }
});

// Unified request-otp that accepts purpose from frontend
router.post("/request-otp", async (req, res, next) => {
  try {
    console.log("[REQUEST-OTP] Request body:", req.body);
    const { email, purpose } = requestOtpUnifiedSchema.parse(req.body);
    console.log("[REQUEST-OTP] Validated email:", email, "purpose:", purpose);

    const mapPurpose = (p: "register" | "forgot-password" | "change-password"): OtpPurposeType =>
      p === "register" ? "REGISTER" : "FORGOT_PASSWORD";

    await authService.sendOtpForPurpose(email, mapPurpose(purpose));
    console.log("[REQUEST-OTP] OTP sent successfully for purpose:", purpose);
    res.status(200).json({
      success: true,
      message: purpose === "register" ? "OTP verifikasi registrasi telah dikirim." : "Password Reset OTP telah dikirim (bila email terdaftar).",
      purpose,
    });
  } catch (error) {
    console.error("[REQUEST-OTP] Error:", error);
    if (error instanceof ZodError) {
      console.error("[REQUEST-OTP] Validation error:", error.issues);
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
        details: error.issues,
      });
    }
    next(error);
  }
});

// Request OTP for registration verification
router.post("/request-otp-register", async (req, res, next) => {
  try {
    console.log("[REQUEST-OTP-REGISTER] Request body:", req.body);
    const { email } = requestOtpSchema.parse(req.body);
    await authService.sendOtpForPurpose(email, "REGISTER");
    res.status(200).json({
      success: true,
      message: "OTP verifikasi registrasi telah dikirim.",
    });
  } catch (error) {
    console.error("[REQUEST-OTP-REGISTER] Error:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
        details: error.issues,
      });
    }
    next(error);
  }
});

// Verify OTP for registration
router.post("/verify-otp-register", async (req, res, next) => {
  try {
    console.log("[VERIFY-OTP-REGISTER] Request body:", req.body);
    const { email, otp } = verifyRegisterSchema.parse(req.body);
    await authService.verifyOtpForPurpose(email, otp, "REGISTER");
    res.status(200).json({
      success: true,
      message: "Akun berhasil diverifikasi. Silakan login.",
    });
  } catch (error) {
    console.error("[VERIFY-OTP-REGISTER] Error:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: "Invalid input data",
        details: error.issues,
      });
    }
    next(error);
  }
});

// Unified verify-otp with purpose
router.post("/verify-otp", async (req, res, next) => {
  try {
    console.log("[VERIFY-OTP] Request body:", req.body);
    const { email, otp, purpose } = verifyOtpUnifiedSchema.parse(req.body);
    const mapPurpose = (p: "register" | "forgot-password" | "change-password"): OtpPurposeType =>
      p === "register" ? "REGISTER" : "FORGOT_PASSWORD";
    await authService.verifyOtpForPurpose(email, otp, mapPurpose(purpose));

    const msg = purpose === "register"
      ? "Akun berhasil diverifikasi. Silakan login."
      : "OTP valid. Silakan lanjutkan reset password.";

    res.status(200).json({ success: true, message: msg, purpose });
  } catch (error) {
    console.error("[VERIFY-OTP] Error:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: "Invalid input data",
        details: error.issues,
      });
    }
    if (error instanceof HttpError) {
      const code = error.status === 400 ? "OTP_EXPIRED" : error.status === 401 ? "OTP_INVALID" : undefined;
      return res.status(error.status).json({ success: false, code, message: error.message });
    }
    next(error);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    console.log("[RESET-PASSWORD] Request received");
    const { email, otp, newPassword } = resetPasswordSchema.parse(req.body);
    console.log("[RESET-PASSWORD] Validated data for email:", email);
    await authService.resetPasswordService(email, otp, newPassword);
    console.log("[RESET-PASSWORD] Password reset successful");
    res.status(200).json({
      success: true,
      message: "Password has been reset successfully.",
    });
  } catch (error) {
    console.error("[RESET-PASSWORD] Error:", error);
    if (error instanceof ZodError) {
      console.error("[RESET-PASSWORD] Validation error:", error.issues);
      return res.status(400).json({
        success: false,
        error: "Invalid input data",
        details: error.issues,
      });
    }
    next(error);
  }
});

// GET Profile - /api/auth/profile
router.get("/profile", authenticate, async (req, res, next) => {
  try {
    console.log("[GET-PROFILE] Request received for user:", req.user?.userId);

    const userId = req.user?.userId;

    if (!userId) {
      console.error("[GET-PROFILE] User ID not found in token");
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    const user = await findUserById(userId);

    if (!user) {
      console.error("[GET-PROFILE] User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(
      "[GET-PROFILE] Profile retrieved successfully for:",
      user.email,
    );

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        photo_profile: user.photo_profile,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error: any) {
    console.error("[GET-PROFILE] Error:", error);
    next(error);
  }
});

// PUT Update Profile - /api/auth/profile
router.put(
  "/profile",
  authenticate,
  upload.single("photo_profile"),
  async (req, res, next) => {
    try {
      console.log(
        "[UPDATE-PROFILE] Request received for user:",
        req.user?.userId,
      );

      const userId = req.user?.userId;

      if (!userId) {
        console.error("[UPDATE-PROFILE] User ID not found in token");
        return res.status(401).json({
          success: false,
          message: "User ID tidak ditemukan",
        });
      }

      const { username, name, email, phone } = req.body;
      const photoFile = req.file;

      console.log("[UPDATE-PROFILE] Update data:", {
        username,
        name,
        email,
        phone,
        hasPhoto: !!photoFile,
      });

      // Get current user
      const currentUser = await findUserById(userId);

      if (!currentUser) {
        console.error("[UPDATE-PROFILE] User not found:", userId);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Build update object
      const updateData: any = {};

      // Validate and add username if provided
      if (username !== undefined && username !== currentUser.username) {
        if (username.trim().length < 3) {
          return res.status(400).json({
            success: false,
            message: "Username must be at least 3 characters",
          });
        }
        if (username.trim().length > 50) {
          return res.status(400).json({
            success: false,
            message: "Username must not exceed 50 characters",
          });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
          return res.status(400).json({
            success: false,
            message:
              "Username can only contain letters, numbers, and underscores",
          });
        }

        // Check if username already exists
        const existingUsername = await prisma.user.findUnique({
          where: { username },
        });

        if (existingUsername && existingUsername.id !== userId) {
          console.error("[UPDATE-PROFILE] Username already exists:", username);
          return res.status(400).json({
            success: false,
            message: "Username already exists",
          });
        }

        updateData.username = username;
      }

      // Validate and add name if provided
      if (name !== undefined && name.trim() !== currentUser.name) {
        if (name.trim().length < 3) {
          return res.status(400).json({
            success: false,
            message: "Name must be at least 3 characters",
          });
        }
        if (name.trim().length > 100) {
          return res.status(400).json({
            success: false,
            message: "Name must not exceed 100 characters",
          });
        }
        updateData.name = name.trim();
      }

      // Validate and add email if provided
      if (email !== undefined && email !== currentUser.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({
            success: false,
            message: "Invalid email format",
          });
        }

        // Check if email already exists
        const existingEmail = await prisma.user.findUnique({
          where: { email },
        });

        if (existingEmail && existingEmail.id !== userId) {
          console.error("[UPDATE-PROFILE] Email already exists:", email);
          return res.status(400).json({
            success: false,
            message: "Email already exists",
          });
        }

        updateData.email = email;
      }

      // Validate and add phone if provided
      if (phone !== undefined && phone !== currentUser.phone) {
        if (phone.trim() !== "") {
          if (!/^\d+$/.test(phone)) {
            return res.status(400).json({
              success: false,
              message: "Phone must contain only numbers",
            });
          }
          if (phone.length < 10) {
            return res.status(400).json({
              success: false,
              message: "Phone must be at least 10 digits",
            });
          }
          if (phone.length > 15) {
            return res.status(400).json({
              success: false,
              message: "Phone must not exceed 15 digits",
            });
          }
          updateData.phone = phone;
        } else {
          updateData.phone = null;
        }
      }

      // Handle photo upload if provided
      if (photoFile) {
        console.log("[UPDATE-PROFILE] Processing photo upload...");

        // Validate file type
        const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];
        if (!allowedMimeTypes.includes(photoFile.mimetype)) {
          return res.status(400).json({
            success: false,
            message: "Invalid file type. Only JPEG and PNG are allowed",
          });
        }

        // Validate file size (2MB)
        const maxSize = 2 * 1024 * 1024;
        if (photoFile.size > maxSize) {
          return res.status(400).json({
            success: false,
            message: "File size exceeds 2MB limit",
          });
        }

        try {
          // Delete old photo from Cloudinary if exists
          if (currentUser.photo_profile) {
            try {
              const publicId = extractPublicId(currentUser.photo_profile);
              if (publicId) {
                console.log("[UPDATE-PROFILE] Deleting old photo:", publicId);
                await cloudinary.uploader.destroy(publicId);
              }
            } catch (error) {
              console.warn(
                "[UPDATE-PROFILE] Failed to delete old photo:",
                error,
              );
            }
          }

          // Upload new photo to Cloudinary
          const uploadResult = await new Promise<{
            secure_url: string;
            public_id: string;
          }>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: "meesha-users",
                transformation: [
                  { width: 500, height: 500, crop: "fill", gravity: "face" },
                  { quality: "auto" },
                  { fetch_format: "auto" },
                ],
              },
              (error, result) => {
                if (error) {
                  console.error(
                    "[UPDATE-PROFILE] Cloudinary upload error:",
                    error,
                  );
                  return reject(error);
                }
                if (!result) {
                  return reject(new Error("Upload failed - no result"));
                }
                resolve(result);
              },
            );

            uploadStream.end(photoFile.buffer);
          });

          console.log(
            "[UPDATE-PROFILE] Photo uploaded successfully:",
            uploadResult.secure_url,
          );
          updateData.photo_profile = uploadResult.secure_url;
        } catch (error: any) {
          const cloudinaryMessage =
            error?.message || error?.error?.message || "Failed to upload photo";
          console.error("[UPDATE-PROFILE] Photo upload error:", cloudinaryMessage);
          return res.status(500).json({
            success: false,
            message: cloudinaryMessage,
          });
        }
      }

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No fields to update",
        });
      }

      // Update user in database
      updateData.updatedAt = new Date();

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          phone: true,
          photo_profile: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      console.log(
        "[UPDATE-PROFILE] Profile updated successfully for:",
        updatedUser.email,
      );

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: updatedUser,
      });
    } catch (error: any) {
      console.error("[UPDATE-PROFILE] Error:", error);
      next(error);
    }
  },
);

// Helper function to extract public_id from Cloudinary URL
const extractPublicId = (url: string): string | null => {
  try {
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");

    if (uploadIndex === -1) return null;

    const afterUpload = parts.slice(uploadIndex + 1);
    const startIndex = afterUpload[0]?.match(/^v\d+$/) ? 1 : 0;
    const publicId = afterUpload
      .slice(startIndex)
      .join("/")
      .replace(/\.[^/.]+$/, "");

    return publicId || null;
  } catch (error) {
    console.error("[EXTRACT-PUBLIC-ID] Error:", error);
    return null;
  }
};

export default router;
