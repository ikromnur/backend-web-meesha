-- Soft-delete Product: add nullable deletedAt column
-- Non-destructive: existing data remains intact

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP NULL;

