import { PrismaClient } from "@prisma/client";
import { CreateObjectiveDto, UpdateObjectiveDto } from "../types/objective";

export class ObjectiveService {
  constructor(private prisma: PrismaClient) {}

  async findAll() {
    return await this.prisma.objective.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findOne(id: string) {
    const objective = await this.prisma.objective.findUnique({
      where: { id },
    });

    if (!objective) {
      throw new Error("Objective not found");
    }

    return objective;
  }

  async create(data: CreateObjectiveDto) {
    const existing = await this.prisma.objective.findUnique({
      where: { key: data.key },
    });

    if (existing) {
      throw new Error("Objective with this key already exists");
    }

    return await this.prisma.objective.create({
      data: {
        name: data.name,
        key: data.key,
      },
    });
  }

  async update(id: string, data: UpdateObjectiveDto) {
    const existing = await this.prisma.objective.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error("Objective not found");
    }

    if (data.key) {
      const keyExists = await this.prisma.objective.findFirst({
        where: {
          key: data.key,
          NOT: { id },
        },
      });

      if (keyExists) {
        throw new Error("Objective with this key already exists");
      }
    }

    return await this.prisma.objective.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.objective.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error("Objective not found");
    }

    return await this.prisma.objective.delete({
      where: { id },
    });
  }
}
