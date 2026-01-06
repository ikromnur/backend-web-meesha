import { Router, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Use memory storage so we can process with sharp
const upload = multer({
  storage: multer.memoryStorage(),
  // Accept larger files; they will be compressed down by sharp
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max upload size in memory
  },
});

// Ensure uploads directory exists
const ensureUploadsDir = () => {
  const dir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

// Helper to adapt quality to keep file under 2MB
async function toWebpUnder2MB(input: Buffer, maxWidth = 1200): Promise<Buffer> {
  let quality = 80;
  const minQuality = 40;
  const targetBytes = 2 * 1024 * 1024; // 2MB

  // First resize and try with initial quality
  let output = await sharp(input).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality }).toBuffer();

  while (output.byteLength > targetBytes && quality > minQuality) {
    quality -= 10;
    output = await sharp(input).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality }).toBuffer();
  }

  if (output.byteLength > targetBytes) {
    throw new Error("Processed image still exceeds 2MB after compression");
  }

  return output;
}

/**
 * POST /api/upload/image
 * Field name: file
 * Auth: required (user/admin)
 */
router.post("/image", authenticate, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "File tidak ditemukan (field 'file')" });
    }

    const mime = req.file.mimetype;
    if (!mime.startsWith("image/")) {
      return res.status(400).json({ success: false, message: "File harus berupa gambar" });
    }

    // Process with sharp (resize + webp, <=2MB)
    const processed = await toWebpUnder2MB(req.file.buffer, 1200);

    const uploadsDir = ensureUploadsDir();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, processed);

    // Build public URL path served by express static
    const publicPath = `/uploads/${filename}`;

    return res.status(201).json({
      success: true,
      message: "Gambar berhasil diupload dan diproses",
      data: {
        filename,
        path: publicPath,
        size: processed.byteLength,
        mimeType: "image/webp",
      },
    });
  } catch (error: any) {
    console.error("[UPLOAD-IMAGE] Error:", error);
    const message = error?.message || "Gagal memproses gambar";
    return res.status(500).json({ success: false, message });
  }
});

export default router;


