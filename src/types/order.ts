import { OrderStatus } from "@prisma/client";

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  price: number;
}

export interface CreateOrderDto {
  userId: string;
  shippingAddress: string;
  paymentMethod: string;
  paymentMethodCode?: string;
  status?: OrderStatus;
  // Opsional: jadwal ambil dikirim sebagai ISO string, di-convert di service
  pickupAt?: string;
  orderItems: CreateOrderItemDto[];
  discountCode?: string;
}

export interface UpdateOrderDto {
  status?: OrderStatus;
  shippingAddress?: string;
  paymentMethod?: string;
  paymentMethodCode?: string;
  pickupAt?: string; // ISO datetime string (akan di-convert di service)
}

export interface OrderItemResponse {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: number;
  product?: {
    id: string;
    name: string;
    price: number;
    imageUrl?: any;
  };
}

export interface OrderResponse {
  id: string;
  userId: string;
  totalAmount: number;
  status: OrderStatus;
  shippingAddress: string;
  paymentMethod: string;
  paymentMethodCode?: string;
  tripayReference?: string;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
  orderItems: OrderItemResponse[];
}
