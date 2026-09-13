/**
 * The Supabase distribution uses the same server-side Drizzle schema as the
 * Postgres adapter. Re-export it from this package so generated host code does
 * not need to depend on `@userr/neon` directly.
 */
export * from "@userr/neon/schema";
