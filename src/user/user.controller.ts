import { Router, Request, Response } from "express";
import {
  getUserProfileService,
  updateUserProfileService,
  uploadUserPhotoService,
  deleteUserPhotoService,
} from "./user.service";
import { authenticate } from "../middleware/auth.middleware";
import { upload } from "../middleware/upload.middleware";
import { UpdateProfileInput } from "../types/user";
import normalizeUser from "../utils/normalize-user";

const router = Router();

/**
 * @route   GET /api/users/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get("/profile", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    const user = await getUserProfileService(userId);

    return res.status(200).json({
      success: true,
      message: "Profile berhasil diambil",
      data: normalizeUser(user),
    });
  } catch (error: any) {
    console.error("[USER CONTROLLER] Error getting profile:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Gagal mengambil profile",
    });
  }
});

/**
 * @route   PATCH /api/users/profile
 * @desc    Update user profile (username, name, email, phone)
 * @access  Private
 */
  const updateProfileHandler = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    const updateData: UpdateProfileInput = {
      username: req.body.username,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
    };

    // Remove undefined fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key as keyof UpdateProfileInput] === undefined) {
        delete updateData[key as keyof UpdateProfileInput];
      }
    });

    // Jika tidak ada field yang dikirim, anggap sebagai no-op dan kembalikan profil saat ini
    if (Object.keys(updateData).length === 0) {
      const current = await getUserProfileService(userId);
      return res.status(200).json({
        success: true,
        message: "Tidak ada data yang diupdate",
        data: normalizeUser(current),
      });
    }

    const updatedUser = await updateUserProfileService(userId, updateData);

    return res.status(200).json({
      success: true,
      message: "Profile berhasil diupdate",
      data: normalizeUser(updatedUser),
    });
  } catch (error: any) {
    console.error("[USER CONTROLLER] Error updating profile:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Gagal mengupdate profile",
    });
  }
};

router.patch("/profile", authenticate, updateProfileHandler);
// Alias PUT untuk kompatibilitas frontend lama
router.put("/profile", authenticate, updateProfileHandler);

/**
 * @route   POST /api/users/profile/photo
 * @desc    Upload or update user profile photo
 * @access  Private
 */
router.post(
  "/profile/photo",
  authenticate,
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User ID tidak ditemukan",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File foto tidak ditemukan",
        });
      }

      // Validate file type
      const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "Format file tidak didukung. Gunakan JPEG, PNG, atau WebP",
        });
      }

      // Validate file size (already handled by multer, but double check)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (req.file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: "Ukuran file terlalu besar. Maksimal 5MB",
        });
      }

      const updatedUser = await uploadUserPhotoService(userId, req.file.buffer);

      return res.status(200).json({
        success: true,
        message: "Foto profile berhasil diupload",
        data: normalizeUser(updatedUser),
      });
    } catch (error: any) {
      console.error("[USER CONTROLLER] Error uploading photo:", error);
      return res.status(error.status || 500).json({
        success: false,
        message: error.message || "Gagal mengupload foto profile",
      });
    }
  }
);

/**
 * @route   DELETE /api/users/profile/photo
 * @desc    Delete user profile photo
 * @access  Private
 */
router.delete("/profile/photo", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID tidak ditemukan",
      });
    }

    const updatedUser = await deleteUserPhotoService(userId);

    return res.status(200).json({
      success: true,
      message: "Foto profile berhasil dihapus",
      data: normalizeUser(updatedUser),
    });
  } catch (error: any) {
    console.error("[USER CONTROLLER] Error deleting photo:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Gagal menghapus foto profile",
    });
  }
});

export default router;
