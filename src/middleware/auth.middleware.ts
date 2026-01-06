import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import prisma from "../lib/prisma"

interface JwtPayload {
  userId: string
  role: string
}

// Memperluas tipe Request untuk menyertakan user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        role: string
      }
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Akses ditolak. Token tidak ada" } })
    }

    const token = authHeader.split(" ")[1]

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload

      req.user = {
        userId: decoded.userId,
        role: decoded.role,
      }

      next()
    } catch (error) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token tidak valid" } })
    }
  } catch (error) {
    next(error)
  }
}

export const authorizeAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Akses ditolak. Hanya admin yang diizinkan" } })
  }
  next()
}
