import { DiscountStatus, DiscountType } from "@prisma/client";

export interface CreateDiscountDto {
  code: string;
  value: number;
  type: DiscountType;
  startDate: string;
  endDate: string;
  status?: DiscountStatus;
  maxUsage?: number;
  maxUsagePerUser?: number;
}

export interface UpdateDiscountDto {
  code?: string;
  value?: number;
  type?: DiscountType;
  startDate?: string;
  endDate?: string;
  status?: DiscountStatus;
  maxUsage?: number;
  maxUsagePerUser?: number;
}

export interface DiscountResponse {
  id: string;
  code: string;
  value: number;
  type: DiscountType;
  startDate: string;
  endDate: string;
  startDateMs: number;
  endDateMs: number;
  status: DiscountStatus;
  maxUsage?: number | null;
  maxUsagePerUser?: number | null;
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}
