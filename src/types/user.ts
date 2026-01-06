export type User = {
  id?: string;
  username?: string;
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: Role;
  createdAt?: Date;
  updatedAt?: Date;
  photo_profile?: string;
  passwordResetToken?: string | null;
  passwordResetExpires?: Date | null;
  isVerified?: boolean;
  passwordResetWindowUntil?: Date | null;
};

export enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
}

export type UpdateProfileInput = {
  username?: string;
  name?: string;
  email?: string;
  phone?: string;
};

export type ProfileResponse = {
  id: string;
  username: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  photo_profile: string | null;
  createdAt: Date;
  updatedAt: Date;
};
