import { PrismaClient, Discount, Prisma } from '@prisma/client';

// Tidak ada @Injectable() di Express
export class DiscountRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  async create(data: Prisma.DiscountCreateInput): Promise<Discount> {
    return this.prisma.discount.create({ data });
  }

  async findAll(): Promise<Discount[]> {
    return this.prisma.discount.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneById(id: string): Promise<Discount | null> {
    return this.prisma.discount.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<Discount | null> {
    return this.prisma.discount.findUnique({ where: { code } });
  }

  async update(id: string, data: Prisma.DiscountUpdateInput): Promise<Discount> {
    return this.prisma.discount.update({ where: { id }, data });
  }

  async remove(id: string): Promise<Discount> {
    return this.prisma.discount.delete({ where: { id } });
  }
}