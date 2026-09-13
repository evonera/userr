import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { AtomicRateLimiter, RateLimitRequest } from "@userr/core";
import type { Database } from "./repository.js";
import { rateLimitCounters } from "./schema.js";

export interface PostgresRateLimiterOptions { now?: () => number; cleanupLimit?: number; }

function validateRequests(requests: readonly RateLimitRequest[]): void {
  const keys = new Set<string>();
  for (const request of requests) {
    if (!request.key || request.key.length > 500 || keys.has(request.key)) throw new Error("Rate-limit keys must be unique, non-empty, and at most 500 characters.");
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0 || !Number.isSafeInteger(request.windowMs) || request.windowMs <= 0) throw new Error("Rate limits must be positive integers.");
    keys.add(request.key);
  }
}

/** Postgres fixed-window limiter. Rows are locked in key order; denial leaves
 * every counter unchanged, while success increments all counters together. */
export function createPostgresRateLimiter(db: Database, options: PostgresRateLimiterOptions = {}): AtomicRateLimiter {
  return { async consumeAllOrNothing(requests) {
    validateRequests(requests); if (!requests.length) return { allowed: true }; const now = options.now?.() ?? Date.now(); if (!Number.isSafeInteger(now)) throw new Error("Rate-limit time must be a safe integer."); await pruneExpiredRateLimits(db, { before: now, limit: options.cleanupLimit ?? 100 }); const ordered = [...requests].sort((a, b) => a.key.localeCompare(b.key));
    return db.transaction(async (tx) => {
      for (const request of ordered) { const windowStart = Math.floor(now / request.windowMs) * request.windowMs; await tx.insert(rateLimitCounters).values({ key: request.key, windowStart, expiresAt: windowStart + request.windowMs, count: 0 }).onConflictDoNothing(); }
      const rows = await tx.select().from(rateLimitCounters).where(inArray(rateLimitCounters.key, ordered.map((request) => request.key))).orderBy(asc(rateLimitCounters.key)).for("update"); const byKey = new Map(rows.map((row) => [row.key, row])); let retryAfterMs = 0;
      for (const request of ordered) { const row = byKey.get(request.key); if (!row) throw new Error("Rate-limit counter could not be locked."); const windowStart = Math.floor(now / request.windowMs) * request.windowMs; const count = row.windowStart === windowStart ? row.count : 0; if (count >= request.limit) retryAfterMs = Math.max(retryAfterMs, row.windowStart + request.windowMs - now); }
      if (retryAfterMs > 0) return { allowed: false, retryAfterMs };
      for (const request of ordered) { const row = byKey.get(request.key)!; const windowStart = Math.floor(now / request.windowMs) * request.windowMs; const count = row.windowStart === windowStart ? row.count : 0; await tx.update(rateLimitCounters).set({ windowStart, expiresAt: windowStart + request.windowMs, count: count + 1 }).where(eq(rateLimitCounters.key, request.key)); }
      return { allowed: true };
    });
  } };
}

export async function pruneExpiredRateLimits(db: Database, options: { before?: number; limit?: number } = {}): Promise<number> {
  const before = options.before ?? Date.now(); const limit = options.limit ?? 100; if (!Number.isSafeInteger(before) || !Number.isSafeInteger(limit) || limit < 0 || limit > 1_000) throw new Error("Rate-limit cleanup requires a safe time and a limit from 0 to 1000."); if (!limit) return 0;
  const stale = await db.select({ key: rateLimitCounters.key }).from(rateLimitCounters).where(lt(rateLimitCounters.expiresAt, before)).orderBy(asc(rateLimitCounters.expiresAt)).limit(limit); if (!stale.length) return 0; const keys = stale.map((row) => row.key); const deleted = await db.delete(rateLimitCounters).where(and(inArray(rateLimitCounters.key, keys), lt(rateLimitCounters.expiresAt, before))).returning({ key: rateLimitCounters.key }); return deleted.length;
}
