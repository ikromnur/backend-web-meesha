import { PrismaClient } from "@prisma/client";
import { CreateColorDto, UpdateColorDto } from "../types/color";

export class ColorService {
  constructor(private prisma: PrismaClient) {}

  async findAll() {
    return await this.prisma.color.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findOne(id: string) {
    const color = await this.prisma.color.findUnique({
      where: { id },
    });

    if (!color) {
      throw new Error("Color not found");
    }

    return color;
  }

  async create(data: CreateColorDto) {
    const existing = await this.prisma.color.findUnique({
      where: { key: data.key },
    });

    if (existing) {
      throw new Error("Color with this key already exists");
    }

    return await this.prisma.color.create({
      data: {
        name: data.name,
        key: data.key,
      },
    });
  }

  async update(id: string, data: UpdateColorDto) {
    const existing = await this.prisma.color.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error("Color not found");
    }

    if (data.key) {
      const keyExists = await this.prisma.color.findFirst({
        where: {
          key: data.key,
          NOT: { id },
        },
      });

      if (keyExists) {
        throw new Error("Color with this key already exists");
      }
    }

    return await this.prisma.color.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.color.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error("Color not found");
    }

    return await this.prisma.color.delete({
      where: { id },
    });
  }
}
