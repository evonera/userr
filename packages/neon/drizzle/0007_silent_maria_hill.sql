ALTER TABLE "rate_limit_counters" ADD COLUMN "expires_at" bigint;--> statement-breakpoint
-- Migration 0006 did not store the window duration, so its counters cannot be
-- assigned a truthful expiry yet. Keep them conservatively until their next
-- consume, which recalculates expiry from the requested window.
UPDATE "rate_limit_counters" SET "expires_at" = 9223372036854775807 WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expiry_idx" ON "rate_limit_counters" USING btree ("expires_at");
