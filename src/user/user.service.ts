import { v2 as cloudinary } from "cloudinary";
import {
  findUserById,
  findUserByEmail,
  findUserByUsername,
  updateUserProfile,
  updateUserPhoto,
  deleteUserPhoto,
} from "./user.repository";
import { UpdateProfileInput } from "../types/user";
import { HttpError } from "../utils/http-error";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const getUserProfileService = async (userId: string) => {
  try {
    console.log("[USER SERVICE] Getting profile for user:", userId);

    const user = await findUserById(userId);

    if (!user) {
      console.log("[USER SERVICE] User not found:", userId);
      throw new HttpError(404, "User tidak ditemukan");
    }

    console.log("[USER SERVICE] Profile retrieved successfully");
    return user;
  } catch (error) {
    console.error("[USER SERVICE] Error getting profile:", error);
    throw error;
  }
};

export const updateUserProfileService = async (
  userId: string,
  data: UpdateProfileInput
) => {
  try {
    console.log("[USER SERVICE] Updating profile for user:", userId);

    // Check if user exists
    const existingUser = await findUserById(userId);
    if (!existingUser) {
      console.log("[USER SERVICE] User not found:", userId);
      throw new HttpError(404, "User tidak ditemukan");
    }

    // Check if email is being changed and already exists
    if (data.email && data.email !== existingUser.email) {
      const emailExists = await findUserByEmail(data.email);
      if (emailExists) {
        console.log("[USER SERVICE] Email already in use:", data.email);
        throw new HttpError(400, "Email sudah digunakan oleh user lain");
      }
    }

    // Check if username is being changed and already exists
    if (data.username && data.username !== existingUser.username) {
      const usernameExists = await findUserByUsername(data.username);
      if (usernameExists) {
        console.log("[USER SERVICE] Username already in use:", data.username);
        throw new HttpError(400, "Username sudah digunakan oleh user lain");
      }
    }

    console.log("[USER SERVICE] Updating user data in database...");
    const updatedUser = await updateUserProfile(userId, data);

    console.log("[USER SERVICE] Profile updated successfully");
    return updatedUser;
  } catch (error) {
    console.error("[USER SERVICE] Error updating profile:", error);
    throw error;
  }
};

export const uploadUserPhotoService = async (
  userId: string,
  fileBuffer: Buffer
) => {
  try {
    console.log("[USER SERVICE] Uploading photo for user:", userId);

    // Check if user exists
    const existingUser = await findUserById(userId);
    if (!existingUser) {
      console.log("[USER SERVICE] User not found:", userId);
      throw new HttpError(404, "User tidak ditemukan");
    }

    // Delete old photo from Cloudinary if exists
    if (existingUser.photo_profile) {
      try {
        const publicId = extractPublicId(existingUser.photo_profile);
        if (publicId) {
          console.log("[USER SERVICE] Deleting old photo from Cloudinary:", publicId);
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (error) {
        console.warn("[USER SERVICE] Failed to delete old photo:", error);
        // Continue with upload even if delete fails
      }
    }

    // Upload new photo to Cloudinary
    console.log("[USER SERVICE] Uploading new photo to Cloudinary...");
    const uploadResult = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
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
              console.error("[USER SERVICE] Cloudinary upload error:", error);
              return reject(error);
            }
            if (!result) {
              return reject(new Error("Upload failed - no result"));
            }
            resolve(result);
          }
        );

        uploadStream.end(fileBuffer);
      }
    );

    console.log("[USER SERVICE] Photo uploaded to Cloudinary:", uploadResult.secure_url);

    // Update user photo in database
    const updatedUser = await updateUserPhoto(userId, uploadResult.secure_url);

    console.log("[USER SERVICE] User photo updated successfully");
    return updatedUser;
  } catch (error) {
    console.error("[USER SERVICE] Error uploading photo:", error);
    throw error instanceof HttpError ? error : new HttpError(500, "Gagal mengupload foto");
  }
};

export const deleteUserPhotoService = async (userId: string) => {
  try {
    console.log("[USER SERVICE] Deleting photo for user:", userId);

    // Check if user exists
    const existingUser = await findUserById(userId);
    if (!existingUser) {
      console.log("[USER SERVICE] User not found:", userId);
      throw new HttpError(404, "User tidak ditemukan");
    }

    // Check if user has a photo
    if (!existingUser.photo_profile) {
      console.log("[USER SERVICE] User has no photo to delete");
      throw new HttpError(400, "User tidak memiliki foto profile");
    }

    // Delete photo from Cloudinary
    try {
      const publicId = extractPublicId(existingUser.photo_profile);
      if (publicId) {
        console.log("[USER SERVICE] Deleting photo from Cloudinary:", publicId);
        await cloudinary.uploader.destroy(publicId);
        console.log("[USER SERVICE] Photo deleted from Cloudinary successfully");
      }
    } catch (error) {
      console.warn("[USER SERVICE] Failed to delete photo from Cloudinary:", error);
      // Continue with database update even if Cloudinary delete fails
    }

    // Update user photo in database (set to null)
    const updatedUser = await deleteUserPhoto(userId);

    console.log("[USER SERVICE] User photo deleted successfully");
    return updatedUser;
  } catch (error) {
    console.error("[USER SERVICE] Error deleting photo:", error);
    throw error;
  }
};

// Helper function to extract public_id from Cloudinary URL
const extractPublicId = (url: string): string | null => {
  try {
    // Example URL: https://res.cloudinary.com/demo/image/upload/v1234567890/meesha-users/abc123.jpg
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");

    if (uploadIndex === -1) return null;

    // Get everything after "upload/" (skip version if present)
    const afterUpload = parts.slice(uploadIndex + 1);

    // Skip version if it starts with 'v' followed by numbers
    const startIndex = afterUpload[0]?.match(/^v\d+$/) ? 1 : 0;

    // Join the remaining parts and remove file extension
    const publicId = afterUpload.slice(startIndex).join("/").replace(/\.[^/.]+$/, "");

    return publicId || null;
  } catch (error) {
    console.error("[USER SERVICE] Error extracting public_id:", error);
    return null;
  }
};

export default {
  getUserProfileService,
  updateUserProfileService,
  uploadUserPhotoService,
  deleteUserPhotoService,
};
