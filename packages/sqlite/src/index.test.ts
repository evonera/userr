import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createClient } from "@libsql/client";

import { SQLITE_MIGRATION_PATH, SQLITE_SEARCH_CAPABILITIES, toFtsQuery } from "./index.js";

test("SQLite migration creates the portable schema and FTS index", async () => {
  const client = createClient({ url: ":memory:" });
  const migration = await readFile(
    fileURLToPath(new URL("../migrations/0000_userr_schema.sql", import.meta.url)),
    "utf8",
  );
  await client.executeMultiple(migration);
  await client.execute({ sql: "insert into boards values (?, ?, ?, ?, ?, ?, ?)", args: ["b", "feedback", "Feedback", "public", "[\"idea\"]", "[\"inbox\"]", 1] });
  await client.execute({ sql: "insert into items (id, board_id, public_id, slug, title, body, normalized_title, search_text, kind, state, author_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["i", "b", "F-1", "dark-mode-f-1", "Dark mode", "Please add dark mode", "dark mode", "dark mode please add dark mode", "idea", "inbox", "alice", 1, 1] });
  const result = await client.execute({ sql: "select item_id from items_fts where items_fts match ?", args: [toFtsQuery("dark mode")] });
  assert.deepEqual(result.rows.map((row) => row.item_id), ["i"]);
  assert.equal(SQLITE_MIGRATION_PATH, "migrations/0000_userr_schema.sql");
  assert.equal(SQLITE_SEARCH_CAPABILITIES.semanticVector, false);
  await client.close();
});

test("FTS query escapes literal quotes and joins terms", () => {
  assert.equal(toFtsQuery('dark "mode"'), '"dark" AND """mode"""');
});
