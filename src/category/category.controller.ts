import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { CategoryService } from './category.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../types/category';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';

const router = Router();
const categoryService = new CategoryService(prisma);

// GET /api/categories (private)
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await categoryService.findAll();
    res.status(200).json({ data: results });
  } catch (error) {
    console.error('Error in GET /api/categories:', error);
    next(error);
  }
});

// GET /api/categories/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await categoryService.findOne(id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/categories
// Validation schema sesuai kontrak frontend
const categoryCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/, 'Format key tidak valid'),
  name: z.string().min(1, 'Nama kategori wajib diisi'),
  description: z.string().optional().default(''),
});
// Schema untuk update (optional fields tetapi tervalidasi)
const categoryUpdateSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/, 'Format key tidak valid').optional(),
  name: z.string().min(1, 'Nama kategori wajib diisi').optional(),
  description: z.string().optional(),
});

router.post('/', authenticate, authorizeAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = categoryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues?.[0]?.message || 'Format payload tidak valid',
      });
    }

    const { key, name, description } = parsed.data;

    // Cek duplikasi key terlebih dahulu
    const exists = await prisma.category.findUnique({ where: { key } });
    if (exists) {
      return res.status(409).json({ message: 'Key kategori sudah digunakan' });
    }

    const payload: CreateCategoryDto = { key, name, description };
    const result = await categoryService.create(payload);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    // Map Prisma unique constraint error ke 409
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Key kategori sudah digunakan' });
    }
    next(error);
  }
});

// PATCH /api/categories/:id
router.patch('/:id', authenticate, authorizeAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const parsed = categoryUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues?.[0]?.message || 'Format payload tidak valid',
      });
    }

    const updateCategoryDto: UpdateCategoryDto = parsed.data;
    const result = await categoryService.update(id, updateCategoryDto);
    res.status(200).json({ data: result });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Key kategori sudah digunakan' });
    }
    next(error);
  }
});

// DELETE /api/categories/:id
router.delete('/:id', authenticate, authorizeAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await categoryService.remove(id);
    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
