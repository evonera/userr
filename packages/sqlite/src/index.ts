/** SQLite/libSQL capability contract. Semantic/vector search is intentionally
 * absent; callers always retain the core lexical duplicate workflow. */
export const SQLITE_MIGRATION_PATH = "migrations/0000_userr_schema.sql";
export const SQLITE_SEARCH_CAPABILITIES = {
  lexical: "fts5",
  normalizedTitle: true,
  semanticVector: false,
  realtime: "polling-or-host-push",
} as const;

/** Creates a safe FTS5 MATCH expression for a user-provided query. */
export function toFtsQuery(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" AND ");
}
