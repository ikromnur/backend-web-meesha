import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/http-error";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err.stack || err);

  // Check for HttpError via instanceof OR status property (duck typing)
  if (
    err instanceof HttpError ||
    (err.status && err.status >= 400 && err.status < 600)
  ) {
    return res.status(err.status).json({
      message: err.message,
    });
  }

  res.status(500).json({
    message:
      "Terjadi kesalahan pada server: " + (err.message || "Unknown error"),
    detail: err.message, // Expose error message for debugging
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};
