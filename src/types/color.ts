export interface CreateColorDto {
  name: string;
  key: string;
}

export interface UpdateColorDto {
  name?: string;
  key?: string;
}

export interface ColorResponse {
  id: string;
  name: string;
  key: string;
  createdAt: Date;
  updatedAt: Date;
}
