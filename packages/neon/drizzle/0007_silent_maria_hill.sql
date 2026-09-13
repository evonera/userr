ALTER TABLE "rate_limit_counters" ADD COLUMN "expires_at" bigint;--> statement-breakpoint
UPDATE "rate_limit_counters" SET "expires_at" = "window_start" WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expiry_idx" ON "rate_limit_counters" USING btree ("expires_at");
