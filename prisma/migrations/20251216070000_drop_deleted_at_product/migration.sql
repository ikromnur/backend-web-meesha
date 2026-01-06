-- Drop soft-delete column from Product
ALTER TABLE "Product" DROP COLUMN IF EXISTS "deletedAt";
