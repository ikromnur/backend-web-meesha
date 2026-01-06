import { PrismaClient, Discount, Prisma } from "@prisma/client";
import { DiscountRepository } from "./discount.repository";
import {
  CreateDiscountDto,
  UpdateDiscountDto,
  DiscountResponse,
} from "../types/discount";
import { HttpError } from "../utils/http-error";
import { NotificationService } from "../notification/notification.service";

export class DiscountService {
  private discountRepository: DiscountRepository;
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.discountRepository = new DiscountRepository(prismaClient);
    this.prisma = prismaClient;
  }

  async create(
    createDiscountDto: CreateDiscountDto & {
      maxUsage?: number;
      maxUsagePerUser?: number;
    }
  ): Promise<DiscountResponse> {
    if (
      new Date(createDiscountDto.startDate) >=
      new Date(createDiscountDto.endDate)
    ) {
      throw new HttpError(400, "endDate must be after startDate");
    }

    const existingDiscount = await this.discountRepository.findByCode(
      createDiscountDto.code
    );
    if (existingDiscount) {
      throw new HttpError(
        409,
        `Discount with code '${createDiscountDto.code}' already exists.`
      );
    }

    const dataToCreate: Prisma.DiscountCreateInput = {
      code: createDiscountDto.code,
      type: createDiscountDto.type,
      value: new Prisma.Decimal(createDiscountDto.value),
      startDate: new Date(createDiscountDto.startDate),
      endDate: new Date(createDiscountDto.endDate),
      status: createDiscountDto.status || "ACTIVE",
      maxUsage: createDiscountDto.maxUsage,
      maxUsagePerUser: createDiscountDto.maxUsagePerUser,
      usedCount: 0,
    };

    const created = await this.discountRepository.create(dataToCreate);
    return this.mapToResponse(created);
  }

  async findAll(): Promise<DiscountResponse[]> {
    const results = await this.discountRepository.findAll();
    return results.map(this.mapToResponse);
  }

  async findOne(id: string): Promise<DiscountResponse> {
    const discount = await this.discountRepository.findOneById(id);
    if (!discount) {
      throw new HttpError(404, `Discount with ID '${id}' not found.`);
    }
    return this.mapToResponse(discount);
  }

  async findByCode(code: string): Promise<DiscountResponse | null> {
    const discount = await this.discountRepository.findByCode(code);
    if (!discount) return null;
    return this.mapToResponse(discount);
  }

  async update(
    id: string,
    updateDiscountDto: UpdateDiscountDto & {
      maxUsage?: number;
      maxUsagePerUser?: number;
    }
  ): Promise<DiscountResponse> {
    const existing = await this.discountRepository.findOneById(id);
    if (!existing) {
      throw new HttpError(404, `Discount with ID '${id}' not found.`);
    }

    if (
      typeof updateDiscountDto.value !== "undefined" &&
      updateDiscountDto.value < 0
    ) {
      throw new HttpError(400, "value must be >= 0");
    }

    if (
      updateDiscountDto.startDate &&
      Number.isNaN(Date.parse(updateDiscountDto.startDate))
    ) {
      throw new HttpError(400, "startDate tidak valid");
    }
    if (
      updateDiscountDto.endDate &&
      Number.isNaN(Date.parse(updateDiscountDto.endDate))
    ) {
      throw new HttpError(400, "endDate tidak valid");
    }

    const nextStart = updateDiscountDto.startDate
      ? new Date(updateDiscountDto.startDate)
      : existing.startDate;
    const nextEnd = updateDiscountDto.endDate
      ? new Date(updateDiscountDto.endDate)
      : existing.endDate;
    if (nextStart >= nextEnd) {
      throw new HttpError(400, "endDate must be after startDate");
    }

    if (updateDiscountDto.code) {
      const existingDiscount = await this.discountRepository.findByCode(
        updateDiscountDto.code
      );
      if (existingDiscount && existingDiscount.id !== id) {
        throw new HttpError(
          409,
          `Discount with code '${updateDiscountDto.code}' already exists.`
        );
      }
    }

    const dataToUpdate: Prisma.DiscountUpdateInput = {
      ...(typeof updateDiscountDto.code !== "undefined" && {
        code: updateDiscountDto.code,
      }),
      ...(typeof updateDiscountDto.value !== "undefined" && {
        value: new Prisma.Decimal(updateDiscountDto.value),
      }),
      ...(typeof updateDiscountDto.type !== "undefined" && {
        type: updateDiscountDto.type,
      }),
      ...(typeof updateDiscountDto.startDate !== "undefined" && {
        startDate: new Date(updateDiscountDto.startDate),
      }),
      ...(typeof updateDiscountDto.endDate !== "undefined" && {
        endDate: new Date(updateDiscountDto.endDate),
      }),
      ...(typeof updateDiscountDto.status !== "undefined" && {
        status: updateDiscountDto.status,
      }),
      ...(typeof updateDiscountDto.maxUsage !== "undefined" && {
        maxUsage: updateDiscountDto.maxUsage,
      }),
      ...(typeof updateDiscountDto.maxUsagePerUser !== "undefined" && {
        maxUsagePerUser: updateDiscountDto.maxUsagePerUser,
      }),
    };

    const updated = await this.discountRepository.update(id, dataToUpdate);
    return this.mapToResponse(updated);
  }

  async remove(id: string): Promise<Discount> {
    await this.findOne(id);

    // Check if usage exists
    const usageCount = await this.prisma.discountUsage.count({
      where: { discountId: id },
    });

    if (usageCount > 0) {
      throw new HttpError(
        409,
        "Diskon ini sudah pernah digunakan dan tidak dapat dihapus. Silakan nonaktifkan (set ke INACTIVE) saja."
      );
    }

    return this.discountRepository.remove(id);
  }

  // --- Usage Logic ---

  async validateUsage(
    code: string,
    userId?: string,
    orderAmount?: number
  ): Promise<{ valid: boolean; reason?: string }> {
    const discount = await this.discountRepository.findByCode(code);
    if (!discount) return { valid: false, reason: "NOT_FOUND" };

    const now = new Date();
    if (discount.status !== "ACTIVE")
      return { valid: false, reason: "INACTIVE" };
    if (discount.startDate > now)
      return { valid: false, reason: "NOT_STARTED" };
    if (discount.endDate <= now) {
      // Auto-expire
      await this.discountRepository.update(discount.id, { status: "EXPIRED" });
      return { valid: false, reason: "EXPIRED" };
    }

    // Check Global Usage Limit
    if (discount.maxUsage && discount.usedCount >= discount.maxUsage) {
      // Auto-inactive
      await this.discountRepository.update(discount.id, { status: "INACTIVE" });
      return { valid: false, reason: "MAX_USAGE_REACHED" };
    }

    // Check Per User Limit
    if (userId && discount.maxUsagePerUser) {
      const userUsageCount = await this.prisma.discountUsage.count({
        where: {
          discountId: discount.id,
          userId: userId,
        },
      });

      if (userUsageCount >= discount.maxUsagePerUser) {
        return { valid: false, reason: "USER_LIMIT_REACHED" };
      }
    }

    return { valid: true };
  }

  async recordUsage(
    code: string,
    userId: string,
    orderId?: string
  ): Promise<void> {
    const discount = await this.discountRepository.findByCode(code);
    if (!discount) throw new Error("Discount not found");

    // Transaction to ensure consistency
    await this.prisma.$transaction(async (tx) => {
      // Create Usage Record
      await tx.discountUsage.create({
        data: {
          discountId: discount.id,
          userId,
          orderId,
        },
      });

      // Increment Global Count
      const updatedDiscount = await tx.discount.update({
        where: { id: discount.id },
        data: {
          usedCount: { increment: 1 },
        },
      });

      // Check if max usage reached after increment
      if (
        updatedDiscount.maxUsage &&
        updatedDiscount.usedCount >= updatedDiscount.maxUsage
      ) {
        await tx.discount.update({
          where: { id: discount.id },
          data: { status: "INACTIVE" },
        });

        try {
          const notificationService = new NotificationService(
            this.prisma as unknown as PrismaClient
          );

          // Send admin notification (Email + In-App)
          try {
            const { default: emailUtils } = await import("../utils/email.utils");
            await emailUtils.sendAdminNotification(
              `Discount Limit Reached: ${discount.code}`,
              `The discount code <strong>${discount.code}</strong> has reached its maximum usage limit of ${discount.maxUsage} and has been automatically deactivated.`
            );

            // Find all admins to notify
            const admins = await tx.user.findMany({ where: { role: "ADMIN" } });
            for (const admin of admins) {
              await notificationService.create({
                userId: admin.id,
                title: "Discount Limit Reached",
                message: `Discount code ${discount.code} has reached limit.`,
                type: "WARNING",
                link: "/dashboard/discount",
              });
            }
          } catch (err) {
            console.error(
              "Failed to send admin notification for discount limit:",
              err
            );
          }
        } catch (notificationError) {
          console.error("Critical notification error suppressed:", notificationError);
        }
      }
    });
  }

  private mapToResponse(discount: Discount): DiscountResponse {
    return {
      ...discount,
      value: Number(discount.value as unknown as Prisma.Decimal),
      startDate: discount.startDate.toISOString(),
      endDate: discount.endDate.toISOString(),
      startDateMs: discount.startDate.getTime(),
      endDateMs: discount.endDate.getTime(),
    };
  }
}
