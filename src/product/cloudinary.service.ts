import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadImageToCloudinary = async (imageBuffer: Buffer) => {
  return new Promise<{ secure_url: string; public_id: string }>(
    (resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { resource_type: "auto" }, // Menggunakan stream untuk menerima buffer
          (error, result) => {
            if (error) {
              reject(error);
            } else if (result) {
              // Pastikan result ada sebelum mengakses properti
              resolve({
                secure_url: result.secure_url,
                public_id: result.public_id,
              });
            } else {
              reject(new Error("Upload failed, result is undefined"));
            }
          }
        )
        .end(imageBuffer); // Mengirim buffer sebagai stream
    }
  );
};

export const deleteImageFromCloudinary = async (publicId: string) => {
  return await cloudinary.uploader.destroy(publicId);
};
