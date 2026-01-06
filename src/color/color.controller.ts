import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { ColorService } from "./color.service";
import { CreateColorDto, UpdateColorDto } from "../types/color";

const router = Router();
const colorService = new ColorService(prisma);

// GET /api/colors
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await colorService.findAll();
    res.status(200).json(results);
  } catch (error) {
    next(error);
  }
});

// GET /api/colors/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await colorService.findOne(id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/colors
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const createColorDto: CreateColorDto = req.body;
    const result = await colorService.create(createColorDto);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/colors/:id
router.patch(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const updateColorDto: UpdateColorDto = req.body;
      const result = await colorService.update(id, updateColorDto);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/colors/:id
router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await colorService.remove(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
