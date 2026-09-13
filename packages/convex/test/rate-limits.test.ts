import { describe, expect, test } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { setup } from "./setup.js";

describe("Convex widget rate limiter", () => {
  test("increments every key on success and none when any key denies", async () => {
    const t = setup();
    const requests = [
      { key: "subject", limit: 2, windowMs: 60_000 },
      { key: "network", limit: 1, windowMs: 60_000 },
    ];
    await expect(t.mutation(api.rateLimits.consumeAllOrNothing, { requests })).resolves.toEqual({ allowed: true });
    const denied = await t.mutation(api.rateLimits.consumeAllOrNothing, { requests });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    const rows = await t.run(async (ctx) => await ctx.db.query("rateLimitCounters").collect());
    expect(Object.fromEntries(rows.map((row) => [row.key, row.count]))).toEqual({ network: 1, subject: 1 });
  });

  test("admits only one concurrent request at a limit of one", async () => {
    const t = setup();
    const requests = [{ key: "shared", limit: 1, windowMs: 60_000 }];
    const results = await Promise.all([
      t.mutation(api.rateLimits.consumeAllOrNothing, { requests }),
      t.mutation(api.rateLimits.consumeAllOrNothing, { requests }),
    ]);
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
  });

  test("prunes expired rows in a bounded batch", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("rateLimitCounters", { key: `stale-${index}`, windowStart: 0, expiresAt: 1, count: 1 });
      }
      await ctx.db.insert("rateLimitCounters", { key: "live", windowStart: Date.now(), expiresAt: Date.now() + 60_000, count: 1 });
    });
    await t.mutation(api.rateLimits.consumeAllOrNothing, { requests: [] });
    const rows = await t.run(async (ctx) => await ctx.db.query("rateLimitCounters").collect());
    expect(rows.filter((row) => row.key.startsWith("stale-"))).toHaveLength(1);
    expect(rows.some((row) => row.key === "live")).toBe(true);
  });
});
