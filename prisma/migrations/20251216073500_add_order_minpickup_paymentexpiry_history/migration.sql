-- Add minPickupAt, paymentExpiresAt, pickupHistory to Order (non-destructive)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "minPickupAt" TIMESTAMP NULL;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentExpiresAt" TIMESTAMP NULL;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupHistory" JSONB NULL;

-- Index to accelerate cron cancellation
CREATE INDEX IF NOT EXISTS "Order_paymentExpiresAt_idx" ON "Order"("paymentExpiresAt");
