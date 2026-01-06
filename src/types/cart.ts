export type Cart = {
  id?: string;
  userId: string;
  productId: string;
  quantity: number;
  size?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type CartWithProduct = {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
  size: string | null;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
    price: number;
    stock: number;
    imageUrl: any;
    description: string | null;
    size: string | null;
    category: {
      id: string;
      name: string;
      key: string;
    } | null;
    // type: {
    //   id: string;
    //   name: string;
    //   key: string;
    // } | null;
    color: {
      id: string;
      name: string;
      key: string;
    } | null;
    objective: {
      id: string;
      name: string;
      key: string;
    } | null;
  };
};

export type AddToCartInput = {
  productId: string;
  quantity: number;
  size?: string;
};

export type UpdateCartInput = {
  quantity?: number;
  size?: string;
};

export type CartSummary = {
  items: CartWithProduct[];
  totalItems: number;
  totalPrice: number;
};
