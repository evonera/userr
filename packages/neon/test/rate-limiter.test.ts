import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresRateLimiter, pruneExpiredRateLimits } from "../src/rate-limiter.js";
import { rateLimitCounters } from "../src/schema.js";
import { setupDatabase, type TestDb } from "./setup.js";

describe("Postgres widget rate limiter", () => {
  let db: TestDb; let close: () => Promise<void>;
  beforeEach(async () => { ({ db, close } = await setupDatabase()); }); afterEach(async () => close());
  it("increments every key on success and none when any limit denies", async () => {
    const limiter = createPostgresRateLimiter(db, { now: () => 1_000 }); const requests = [{ key: "subject", limit: 2, windowMs: 60_000 }, { key: "network", limit: 1, windowMs: 60_000 }];
    await expect(limiter.consumeAllOrNothing(requests)).resolves.toEqual({ allowed: true }); await expect(limiter.consumeAllOrNothing(requests)).resolves.toEqual({ allowed: false, retryAfterMs: 59_000 });
    const rows = await db.select().from(rateLimitCounters); expect(Object.fromEntries(rows.map((row) => [row.key, row.count]))).toEqual({ network: 1, subject: 1 });
  });
  it("resets expired windows", async () => {
    let now = 1_000; const limiter = createPostgresRateLimiter(db, { now: () => now }); const request = [{ key: "subject", limit: 1, windowMs: 1_000 }];
    await expect(limiter.consumeAllOrNothing(request)).resolves.toEqual({ allowed: true }); now = 2_000; await expect(limiter.consumeAllOrNothing(request)).resolves.toEqual({ allowed: true });
    const rows = await db.select().from(rateLimitCounters); expect(rows[0]).toMatchObject({ windowStart: 2_000, expiresAt: 3_000, count: 1 });
  });
  it("admits only one concurrent request at a limit of one", async () => {
    const limiter = createPostgresRateLimiter(db, { now: () => 1_000 }); const request = [{ key: "shared", limit: 1, windowMs: 60_000 }]; const results = await Promise.all([limiter.consumeAllOrNothing(request), limiter.consumeAllOrNothing(request)]);
    expect(results.filter((result) => result.allowed)).toHaveLength(1); expect(results.filter((result) => !result.allowed)).toHaveLength(1); const rows = await db.select().from(rateLimitCounters); expect(rows[0]?.count).toBe(1);
  });
  it("prunes stale rows in bounded batches without deleting live counters", async () => {
    await db.insert(rateLimitCounters).values([{ key: "stale-a", windowStart: 0, expiresAt: 1, count: 1 }, { key: "stale-b", windowStart: 0, expiresAt: 1, count: 1 }, { key: "live", windowStart: 0, expiresAt: 10_000, count: 1 }]);
    await expect(pruneExpiredRateLimits(db, { before: 5_000, limit: 1 })).resolves.toBe(1); let rows = await db.select().from(rateLimitCounters); expect(rows).toHaveLength(2); await expect(pruneExpiredRateLimits(db, { before: 5_000, limit: 10 })).resolves.toBe(1); rows = await db.select().from(rateLimitCounters); expect(rows.map((row) => row.key)).toEqual(["live"]);
  });
});

describe("rate-limit counter migrations", () => {
  it("backfills existing 0006 counters before requiring expiry", async () => {
    const client = new PGlite();
    await client.waitReady;
    try {
      await client.exec(`
        CREATE TABLE "rate_limit_counters" (
          "key" text PRIMARY KEY NOT NULL,
          "window_start" bigint NOT NULL,
          "count" integer DEFAULT 0 NOT NULL
        );
        INSERT INTO "rate_limit_counters" ("key", "window_start", "count")
        VALUES ('existing', 1234, 2);
        ALTER TABLE "rate_limit_counters" ADD COLUMN "expires_at" bigint;
        UPDATE "rate_limit_counters"
        SET "expires_at" = "window_start"
        WHERE "expires_at" IS NULL;
        ALTER TABLE "rate_limit_counters" ALTER COLUMN "expires_at" SET NOT NULL;
        CREATE INDEX "rate_limit_counters_expiry_idx"
        ON "rate_limit_counters" USING btree ("expires_at");
      `);
      const result = await client.query<{ expires_at: number }>(
        'SELECT "expires_at" FROM "rate_limit_counters" WHERE "key" = $1',
        ["existing"],
      );
      expect(result.rows).toEqual([{ expires_at: 1234 }]);
      await expect(
        client.exec(
          'INSERT INTO "rate_limit_counters" ("key", "window_start", "count", "expires_at") VALUES (\'invalid\', 0, 0, NULL)',
        ),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});
