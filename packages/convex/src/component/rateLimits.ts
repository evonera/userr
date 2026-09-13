import { v } from "convex/values";

import { mutation } from "./_generated/server.js";

const request = v.object({ key: v.string(), limit: v.number(), windowMs: v.number() });
const MAX_KEYS = 10;
const MAX_KEY_LENGTH = 500;
const CLEANUP_LIMIT = 100;

/**
 * Convex mutations are serialized transactions. Validate the complete request,
 * inspect every counter, and only then patch them, so a denial cannot consume
 * one quota while leaving another unchanged.
 */
export const consumeAllOrNothing = mutation({
  args: { requests: v.array(request) },
  returns: v.object({ allowed: v.boolean(), retryAfterMs: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    if (args.requests.length > MAX_KEYS) throw new Error(`At most ${MAX_KEYS} rate-limit keys are allowed.`);
    const keys = new Set<string>();
    for (const entry of args.requests) {
      if (!entry.key || entry.key.length > MAX_KEY_LENGTH || keys.has(entry.key)) throw new Error("Rate-limit keys must be unique, non-empty, and at most 500 characters.");
      if (!Number.isSafeInteger(entry.limit) || entry.limit <= 0 || !Number.isSafeInteger(entry.windowMs) || entry.windowMs <= 0) throw new Error("Rate limits must be positive integers.");
      keys.add(entry.key);
    }
    const now = Date.now();
    const stale = await ctx.db.query("rateLimitCounters").withIndex("by_expires_at", (q) => q.lt("expiresAt", now)).take(CLEANUP_LIMIT);
    for (const counter of stale) await ctx.db.delete(counter._id);

    const counters = await Promise.all(args.requests.map(async (entry) => ({
      entry,
      counter: await ctx.db.query("rateLimitCounters").withIndex("by_key", (q) => q.eq("key", entry.key)).unique(),
    })));
    let retryAfterMs = 0;
    for (const { entry, counter } of counters) {
      const windowStart = Math.floor(now / entry.windowMs) * entry.windowMs;
      const count = counter?.windowStart === windowStart ? counter.count : 0;
      if (count >= entry.limit && counter) retryAfterMs = Math.max(retryAfterMs, counter.windowStart + entry.windowMs - now);
    }
    if (retryAfterMs > 0) return { allowed: false, retryAfterMs };
    for (const { entry, counter } of counters) {
      const windowStart = Math.floor(now / entry.windowMs) * entry.windowMs;
      const count = counter?.windowStart === windowStart ? counter.count : 0;
      const value = { key: entry.key, windowStart, expiresAt: windowStart + entry.windowMs, count: count + 1 };
      if (counter) await ctx.db.replace(counter._id, value);
      else await ctx.db.insert("rateLimitCounters", value);
    }
    return { allowed: true };
  },
});
