export interface CreateObjectiveDto {
  name: string;
  key: string;
}

export interface UpdateObjectiveDto {
  name?: string;
  key?: string;
}

export interface ObjectiveResponse {
  id: string;
  name: string;
  key: string;
  createdAt: Date;
  updatedAt: Date;
}
