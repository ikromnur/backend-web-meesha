import { PrismaClient, Category, Prisma } from '@prisma/client';
import { CategoryRepository } from './category.repository';
import { HttpError } from '../utils/http-error';
import { CreateCategoryDto, UpdateCategoryDto } from '../types/category';

export class CategoryService {
  private categoryRepository: CategoryRepository;

  constructor(prismaClient: PrismaClient) {
    this.categoryRepository = new CategoryRepository(prismaClient);
  }

  async create(data: CreateCategoryDto): Promise<Category> {
    // Di sini bisa ditambahkan validasi, misalnya cek duplikasi 'key'
    return this.categoryRepository.create(data);
  }

  async findAll(): Promise<Category[]> {
    return this.categoryRepository.findAll();
  }

  async findOne(id: string): Promise<Prisma.CategoryGetPayload<{ include: { products: true } }>> {
    const category = await this.categoryRepository.findById(id);
    if (!category) {
      throw new HttpError(404, `Category with ID '${id}' not found.`);
    }
    return category;
  }

  async update(id: string, data: UpdateCategoryDto): Promise<Category> {
    await this.findOne(id); // Pastikan kategori ada
    return this.categoryRepository.update(id, data);
  }

  async remove(id: string): Promise<Category> {
    const category = await this.findOne(id); // Menggunakan findOne untuk mendapatkan kategori beserta produknya

    if (category.products && category.products.length > 0) {
      throw new HttpError(400, 'Cannot delete category because it still has associated products.');
    }

    return this.categoryRepository.delete(id);
  }
}
