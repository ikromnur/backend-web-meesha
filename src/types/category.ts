export interface CreateCategoryDto {
  key: string;
  name: string;
  description?: string;
}

export interface UpdateCategoryDto {
  key?: string;
  name?: string;
  description?: string;
}
