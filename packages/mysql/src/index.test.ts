import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MYSQL_MIGRATION_PATH,
  MYSQL_SCHEMA_CAPABILITIES,
  MYSQL_SEARCH_CAPABILITIES,
} from "./index.js";

test("publishes an honest, non-vector MySQL capability contract", () => {
  assert.equal(MYSQL_MIGRATION_PATH, "migrations/0000_userr_schema.sql");
  assert.deepEqual(MYSQL_SEARCH_CAPABILITIES, {
    lexical: "innodb-fulltext",
    normalizedTitle: true,
    semanticVector: false,
    realtime: "polling-or-host-push",
  });
  assert.equal(MYSQL_SCHEMA_CAPABILITIES.allTablesHavePrimaryKey, true);
});

test("migration supplies PlanetScale-safe keys and lexical search for every domain table", async () => {
  const sql = await readFile(
    new URL("../migrations/0000_userr_schema.sql", import.meta.url),
    "utf8",
  );
  const tables = [
    "boards", "items", "votes", "comments", "events", "subscriptions",
    "changelog_entries", "roadmap_lanes", "webhooks", "deliveries", "blocked_actors",
  ];

  for (const table of tables) {
    const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, "i"));
    assert.ok(match, `${table} has an InnoDB table definition`);
    assert.match(match[1]!, /PRIMARY KEY/i, `${table} has a stable primary key`);
  }
  assert.match(sql, /FULLTEXT KEY items_search_fulltext \(title, body\)/);
  const statements = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(statements, /FOREIGN KEY/i);
  assert.match(sql, /DEFAULT CHARSET=utf8mb4/g);
});
