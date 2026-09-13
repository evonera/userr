import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createClient } from "@libsql/client";

import { createRepository, SQLITE_MIGRATION_PATH, SQLITE_SEARCH_CAPABILITIES, toFtsQuery } from "./index.js";

async function testClient(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `userr-${name}-`));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  return { client, close: async () => { await client.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("SQLite migration creates the portable schema and FTS index", async () => {
  const { client, close } = await testClient("schema");
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
  await close();
});

test("FTS query escapes literal quotes and joins terms", () => {
  assert.equal(toFtsQuery('dark "mode"'), '"dark" AND """mode"""');
});

test("repository persists board, item, listing, and audited state changes", async () => {
  const { client, close } = await testClient("repository");
  const migration = await readFile(fileURLToPath(new URL("../migrations/0000_userr_schema.sql", import.meta.url)), "utf8");
  await client.executeMultiple(migration);
  const repo = createRepository(client);
  const board = await repo.createBoard({ slug: "feedback", name: "Feedback", visibility: "public", allowedKinds: ["idea"], statusOrder: ["inbox", "open"] });
  const created = await repo.createItem({ boardId: board.id, title: "Dark mode", body: "Please", kind: "idea", authorId: "alice" });
  assert.equal((await repo.findItem(created.id))?.title, "Dark mode");
  assert.deepEqual(await repo.castVote({ itemId: created.id, actorId: "carol" }), { added: true, voteCount: 1 });
  assert.deepEqual(await repo.castVote({ itemId: created.id, actorId: "carol" }), { added: false, voteCount: 1 });
  assert.deepEqual(await repo.uncastVote({ itemId: created.id, actorId: "carol" }), { removed: true, voteCount: 0 });
  await repo.setState({ itemId: created.id, state: "open", actorId: "moderator" });
  assert.equal((await repo.listItems({ boardId: board.id, limit: 10 })).items[0]?.state, "open");
  const events = await client.execute({ sql: "select type from events where item_id = ? order by created_at", args: [created.id] });
  assert.deepEqual(events.rows.map((row) => row.type), ["created", "vote_added", "vote_removed", "state_changed"]);
  await close();
});
