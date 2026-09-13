/**
 * MySQL/PlanetScale capability contract. This distribution is migration-only
 * for now: it deliberately makes no claim of repository, realtime, or vector
 * parity until an adapter has passed @userr/core conformance against MySQL.
 */
export const MYSQL_MIGRATION_PATH = "migrations/0000_userr_schema.sql";

export const MYSQL_SEARCH_CAPABILITIES = {
  lexical: "innodb-fulltext",
  normalizedTitle: true,
  semanticVector: false,
  realtime: "polling-or-host-push",
} as const;

/** PlanetScale-safe migration constraints for the shipped SQL. */
export const MYSQL_SCHEMA_CAPABILITIES = {
  engine: "InnoDB",
  charset: "utf8mb4",
  foreignKeys: "optional-at-host",
  allTablesHavePrimaryKey: true,
} as const;
