import { Size } from "@prisma/client";

export type Availability = "READY" | "PO_2_DAY" | "PO_5_DAY";

export type ImageAsset = {
  url: string;
  publicId: string;
};

export type Product = {
  id: string;
  name: string;
  description?: string;
  price: number;
  // Backend stores images in Prisma Json field `imageUrl` for legacy compatibility.
  // It can be a single object, array of objects, or (legacy) string URL.
  imageUrl?: ImageAsset | ImageAsset[] | string;
  stock: number;
  availability?: Availability;
  size?: string;
  variant?: string[];
  category: {
    id: string;
    key: string;
    name: string;
  };
  // type is now optional to align with FE: no longer required on create/update
  // type?: {
  //   id: string;
  //   key: string;
  //   name: string;
  // };
  objective: {
    id: string;
    key: string;
    name: string;
  };
  color: {
    id: string;
    key: string;
    name: string;
  };
};

export type UpdateProductInput = {
  name: string;
  price: number;
  stock: number;
  description: string;
  size: "S" | "M" | "L" | "XL" | "XXL";
  variant: string[];
  categoryId: string;
  objectiveId: string;
  colorId: string;
  availability?: Availability;
};

export interface ProductFilter {
  search?: string;
  name?: string;
  category?: string[];
  objective?: string[];
  color?: string[];
  availability?: Availability[];
  price?: {
    gte?: number;
    lte?: number;
  };
  size?: Size[];
  page?: number;
  limit?: number;
}
