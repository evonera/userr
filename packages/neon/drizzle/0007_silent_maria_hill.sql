ALTER TABLE "rate_limit_counters" ADD COLUMN "expires_at" bigint NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expiry_idx" ON "rate_limit_counters" USING btree ("expires_at");