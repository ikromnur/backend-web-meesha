import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { ObjectiveService } from "./objective.service";
import { CreateObjectiveDto, UpdateObjectiveDto } from "../types/objective";

const router = Router();
const objectiveService = new ObjectiveService(prisma);

// GET /api/objectives
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await objectiveService.findAll();
    res.status(200).json(results);
  } catch (error) {
    next(error);
  }
});

// GET /api/objectives/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await objectiveService.findOne(id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/objectives
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const createObjectiveDto: CreateObjectiveDto = req.body;
    const result = await objectiveService.create(createObjectiveDto);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/objectives/:id
router.patch(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const updateObjectiveDto: UpdateObjectiveDto = req.body;
      const result = await objectiveService.update(id, updateObjectiveDto);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/objectives/:id
router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await objectiveService.remove(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
