import { randomUUID } from "node:crypto";

import {
  ITEM_STATES,
  normalizeText,
  type Board,
  type BoardInput,
  type ChangelogInput,
  type CursorPage,
  type FeedbackItem,
  type ItemInput,
  type ItemState,
  type MergePlan,
  type LaneInput,
  type ModerationState,
} from "@userr/core";

export type SqliteValue = string | number | bigint | null;
export interface SqliteResult {
  rows: readonly Record<string, unknown>[];
  rowsAffected?: number;
}
export interface SqliteStatement {
  sql: string;
  args?: SqliteValue[];
}
/** Structural subset shared by @libsql/client's node, web, and Turso clients. */
export interface SqliteClient {
  execute(statement: SqliteStatement | string): Promise<SqliteResult>;
  batch?(statements: SqliteStatement[], mode?: "write"): Promise<readonly SqliteResult[]>;
  transaction?(mode?: "write"): Promise<SqliteTransaction>;
}
export interface SqliteTransaction {
  execute(statement: SqliteStatement | string): Promise<SqliteResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
function json(value: unknown): string { return JSON.stringify(value); }
function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function number(value: unknown): number { return typeof value === "bigint" ? Number(value) : Number(value); }
function slug(title: string, publicId: string): string {
  return `${normalizeText(title).replaceAll(" ", "-").slice(0, 72) || "feedback"}-${publicId.toLowerCase()}`;
}

function board(row: Record<string, unknown>): Board {
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name),
    visibility: row.visibility === "private" ? "private" : "public",
    allowedKinds: parse<Board["allowedKinds"]>(row.allowed_kinds, []),
    statusOrder: parse<Board["statusOrder"]>(row.status_order, []),
  };
}
function item(row: Record<string, unknown>): FeedbackItem {
  return {
    id: String(row.id), boardId: String(row.board_id), publicId: String(row.public_id),
    slug: String(row.slug), title: String(row.title), body: String(row.body),
    kind: row.kind as FeedbackItem["kind"], state: row.state as FeedbackItem["state"],
    authorId: String(row.author_id), createdAt: number(row.created_at), updatedAt: number(row.updated_at),
    voteCount: number(row.vote_count), commentCount: number(row.comment_count),
    ...(row.merged_into ? { mergedInto: String(row.merged_into) } : {}),
    moderation: row.moderation as FeedbackItem["moderation"],
    labels: parse<readonly string[]>(row.labels, []),
    ...(row.context ? { context: parse<NonNullable<FeedbackItem["context"]>>(row.context, {}) } : {}),
  };
}

async function one(client: SqliteClient, statement: SqliteStatement): Promise<Record<string, unknown> | null> {
  return (await client.execute(statement)).rows[0] ?? null;
}
async function write<T>(client: SqliteClient, work: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
  if (!client.transaction) throw new Error("SQLite client must support write transactions.");
  const tx = await client.transaction("write");
  try { const result = await work(tx); await tx.commit(); return result; }
  catch (error) { await tx.rollback(); throw error; }
}

/**
 * First SQLite repository slice. It intentionally speaks the same persisted
 * table layout as the migration; remaining contract operations are added in
 * subsequent commits before this package may claim conformance parity.
 */
export function createRepository(client: SqliteClient) {
  return {
    async createBoard(input: BoardInput): Promise<Board> {
      const result = await client.execute({ sql: "select id from boards where slug = ?", args: [input.slug] });
      if (result.rows[0]) throw new Error("Board slug is already taken.");
      const value: Board = { id: id("board"), ...input };
      await client.execute({
        sql: "insert into boards (id, slug, name, visibility, allowed_kinds, status_order, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        args: [value.id, value.slug, value.name, value.visibility, json(value.allowedKinds), json(value.statusOrder), Date.now()],
      });
      return value;
    },
    async findBoardBySlug(slugValue: string): Promise<Board | null> {
      const row = await one(client, { sql: "select * from boards where slug = ?", args: [slugValue] });
      return row ? board(row) : null;
    },
    async createItem(input: ItemInput): Promise<FeedbackItem> {
      const blocked = await one(client, { sql: "select 1 from blocked_actors where board_id = ? and actor_id = ?", args: [input.boardId, input.authorId] });
      if (blocked) throw new Error("Permission denied: actor is blocked on this board.");
      const now = Date.now();
      const itemId = id("item");
      const publicId = itemId.slice(-8).toUpperCase();
      const value: FeedbackItem = {
        id: itemId, boardId: input.boardId, publicId, slug: slug(input.title, publicId),
        title: input.title, body: input.body, kind: input.kind, state: "inbox", authorId: input.authorId,
        createdAt: now, updatedAt: now, voteCount: 0, commentCount: 0, moderation: "approved", labels: [],
        ...(input.context ? { context: input.context } : {}),
      };
      const statements: SqliteStatement[] = [
        { sql: "insert into items (id, board_id, public_id, slug, title, body, normalized_title, search_text, kind, state, author_id, vote_count, comment_count, labels, moderation, context, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', 'approved', ?, ?, ?)", args: [value.id, value.boardId, value.publicId, value.slug, value.title, value.body, normalizeText(value.title), `${value.title} ${value.body}`, value.kind, value.state, value.authorId, value.context ? json(value.context) : null, now, now] },
        { sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'created', ?, '{}', ?)", args: [id("evt"), value.id, value.authorId, now] },
      ];
      if (!client.batch) throw new Error("SQLite client must support transactional batch writes.");
      await client.batch(statements, "write");
      return value;
    },
    async findItem(itemId: string): Promise<FeedbackItem | null> {
      const row = await one(client, { sql: "select * from items where id = ?", args: [itemId] });
      return row ? item(row) : null;
    },
    async findCanonicalItem(itemId: string): Promise<FeedbackItem | null> {
      let current = await this.findItem(itemId);
      const seen = new Set<string>();
      while (current?.mergedInto) {
        if (seen.has(current.id)) throw new Error("Merged item cycle detected.");
        seen.add(current.id);
        current = await this.findItem(current.mergedInto);
      }
      return current;
    },
    async listItems(input: { boardId: string; cursor?: string; limit: number; state?: ItemState; moderation?: ModerationState; includeModerated?: boolean }): Promise<CursorPage<FeedbackItem>> {
      const cursor = input.cursor ? Number(input.cursor) : 0;
      const filters = ["board_id = ?"]; const args: SqliteValue[] = [input.boardId];
      if (input.state) { filters.push("state = ?"); args.push(input.state); }
      if (input.moderation) { filters.push("moderation = ?"); args.push(input.moderation); }
      else if (!input.includeModerated) filters.push("moderation = 'approved'");
      const rows = (await client.execute({ sql: `select * from items where ${filters.join(" and ")} order by created_at, id limit ? offset ?`, args: [...args, input.limit + 1, cursor] })).rows;
      const hasMore = rows.length > input.limit;
      return { items: rows.slice(0, input.limit).map(item), nextCursor: hasMore ? String(cursor + input.limit) : null };
    },
    async setState(input: { itemId: string; state: ItemState; actorId: string }): Promise<void> {
      if (!ITEM_STATES.includes(input.state) || input.state === "merged") throw new Error("Invalid state transition.");
      const previous = await one(client, { sql: "select state from items where id = ?", args: [input.itemId] });
      if (!previous) throw new Error("Feedback item not found.");
      if (previous.state === input.state) return;
      const now = Date.now();
      if (!client.batch) throw new Error("SQLite client must support transactional batch writes.");
      await client.batch([
        { sql: "update items set state = ?, updated_at = ? where id = ?", args: [input.state, now, input.itemId] },
        { sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'state_changed', ?, ?, ?)", args: [id("evt"), input.itemId, input.actorId, json({ from: previous.state, to: input.state }), now] },
      ], "write");
    },
    async setStateMany(input: { itemIds: readonly string[]; state: ItemState; actorId: string }): Promise<{ updated: number }> {
      if (!ITEM_STATES.includes(input.state) || input.state === "merged") throw new Error("Invalid state transition.");
      const ids = [...new Set(input.itemIds)];
      if (ids.length === 0 || ids.length > 50) throw new Error("Bulk transition requires 1 to 50 items.");
      return write(client, async (tx) => {
        const placeholders = ids.map(() => "?").join(",");
        const rows = (await tx.execute({ sql: `select id, state from items where id in (${placeholders})`, args: ids })).rows;
        if (rows.length !== ids.length) throw new Error("Feedback item not found.");
        const now = Date.now(); let updated = 0;
        for (const row of rows) { if (row.state === input.state) continue; updated++; await tx.execute({ sql: "update items set state = ?, updated_at = ? where id = ?", args: [input.state, now, String(row.id)] }); await tx.execute({ sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'state_changed', ?, ?, ?)", args: [id("evt"), String(row.id), input.actorId, json({ from: row.state, to: input.state }), now] }); }
        return { updated };
      });
    },
    async reportItem(input: { itemId: string; actorId: string; reason?: string }): Promise<void> {
      const now = Date.now();
      if (!client.batch) throw new Error("SQLite client must support transactional batch writes.");
      await client.batch([{ sql: "update items set moderation = 'pending', updated_at = ? where id = ?", args: [now, input.itemId] }, { sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'flagged', ?, ?, ?)", args: [id("evt"), input.itemId, input.actorId, json(input.reason ? { reason: input.reason } : {}), now] }], "write");
    },
    async reviewItem(input: { itemId: string; decision: "approved" | "rejected" | "spam"; actorId: string }): Promise<void> {
      const now = Date.now();
      if (!client.batch) throw new Error("SQLite client must support transactional batch writes.");
      await client.batch([{ sql: "update items set moderation = ?, updated_at = ? where id = ?", args: [input.decision, now, input.itemId] }, { sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'moderated', ?, ?, ?)", args: [id("evt"), input.itemId, input.actorId, json({ decision: input.decision }), now] }], "write");
    },
    async blockActor(input: { boardId: string; actorId: string; reason?: string }): Promise<void> { await client.execute({ sql: "insert into blocked_actors (board_id, actor_id, reason, created_at) values (?, ?, ?, ?) on conflict(board_id, actor_id) do update set reason = excluded.reason", args: [input.boardId, input.actorId, input.reason ?? null, Date.now()] }); },
    async unblockActor(input: { boardId: string; actorId: string }): Promise<void> { await client.execute({ sql: "delete from blocked_actors where board_id = ? and actor_id = ?", args: [input.boardId, input.actorId] }); },
    async isBlocked(input: { boardId: string; actorId: string }): Promise<boolean> { return !!(await one(client, { sql: "select 1 from blocked_actors where board_id = ? and actor_id = ?", args: [input.boardId, input.actorId] })); },
    async subscribe(input: { itemId: string; actorId: string; notifyComments?: boolean; notifyStatusChanges?: boolean }): Promise<void> {
      await client.execute({ sql: "insert into subscriptions (item_id, actor_id, notify_comments, notify_status_changes, created_at) values (?, ?, ?, ?, ?) on conflict(item_id, actor_id) do update set notify_comments = excluded.notify_comments, notify_status_changes = excluded.notify_status_changes", args: [input.itemId, input.actorId, input.notifyComments === false ? 0 : 1, input.notifyStatusChanges === false ? 0 : 1, Date.now()] });
    },
    async unsubscribe(input: { itemId: string; actorId: string }): Promise<void> { await client.execute({ sql: "delete from subscriptions where item_id = ? and actor_id = ?", args: [input.itemId, input.actorId] }); },
    async castVote(input: { itemId: string; actorId: string }): Promise<{ added: boolean; voteCount: number }> {
      return write(client, async (tx) => {
        const row = (await tx.execute({ sql: "select board_id, vote_count from items where id = ?", args: [input.itemId] })).rows[0];
        if (!row) throw new Error("Feedback item not found.");
        const blocked = (await tx.execute({ sql: "select 1 from blocked_actors where board_id = ? and actor_id = ?", args: [String(row.board_id), input.actorId] })).rows[0];
        if (blocked) throw new Error("Permission denied: actor is blocked on this board.");
        const inserted = await tx.execute({ sql: "insert or ignore into votes (item_id, actor_id, created_at) values (?, ?, ?)", args: [input.itemId, input.actorId, Date.now()] });
        if (!inserted.rowsAffected) return { added: false, voteCount: number(row.vote_count) };
        const next = number(row.vote_count) + 1;
        const now = Date.now();
        await tx.execute({ sql: "update items set vote_count = ?, updated_at = ? where id = ?", args: [next, now, input.itemId] });
        await tx.execute({ sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'vote_added', ?, '{}', ?)", args: [id("evt"), input.itemId, input.actorId, now] });
        return { added: true, voteCount: next };
      });
    },
    async uncastVote(input: { itemId: string; actorId: string }): Promise<{ removed: boolean; voteCount: number }> {
      return write(client, async (tx) => {
        const row = (await tx.execute({ sql: "select board_id, vote_count from items where id = ?", args: [input.itemId] })).rows[0];
        if (!row) throw new Error("Feedback item not found.");
        const removed = await tx.execute({ sql: "delete from votes where item_id = ? and actor_id = ?", args: [input.itemId, input.actorId] });
        if (!removed.rowsAffected) return { removed: false, voteCount: number(row.vote_count) };
        const next = Math.max(0, number(row.vote_count) - 1);
        const now = Date.now();
        await tx.execute({ sql: "update items set vote_count = ?, updated_at = ? where id = ?", args: [next, now, input.itemId] });
        await tx.execute({ sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'vote_removed', ?, '{}', ?)", args: [id("evt"), input.itemId, input.actorId, now] });
        return { removed: true, voteCount: next };
      });
    },
    async merge(plan: MergePlan): Promise<void> {
      if (plan.sourceId === plan.targetId) throw new Error("Cannot merge an item into itself.");
      await write(client, async (tx) => {
        const source = (await tx.execute({ sql: "select * from items where id = ?", args: [plan.sourceId] })).rows[0];
        const target = (await tx.execute({ sql: "select * from items where id = ?", args: [plan.targetId] })).rows[0];
        if (!source || !target) throw new Error("Feedback item not found.");
        if (source.board_id !== target.board_id) throw new Error("Items must belong to the same board.");
        if (source.state === "shipped" || source.state === "merged" || source.merged_into) throw new Error("Completed or canonical items cannot be merged away.");
        if (target.state === "merged" || target.merged_into) throw new Error("Merge target must be canonical.");
        await tx.execute({ sql: "insert or ignore into votes (item_id, actor_id, created_at) select ?, actor_id, ? from votes where item_id = ?", args: [plan.targetId, plan.mergedAt, plan.sourceId] });
        const targetVotes = (await tx.execute({ sql: "select count(*) as count from votes where item_id = ?", args: [plan.targetId] })).rows[0];
        await tx.execute({ sql: "update items set state = 'merged', merged_into = ?, updated_at = ? where id = ?", args: [plan.targetId, plan.mergedAt, plan.sourceId] });
        await tx.execute({ sql: "update items set vote_count = ?, updated_at = ? where id = ?", args: [number(targetVotes?.count), plan.mergedAt, plan.targetId] });
        await tx.execute({ sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, 'merged', ?, ?, ?)", args: [id("evt"), plan.sourceId, plan.actorId, json({ targetId: plan.targetId, ...(plan.reason ? { reason: plan.reason } : {}) }), plan.mergedAt] });
      });
    },
    async appendEvent(event: { itemId: string; type: "created" | "state_changed" | "merged" | "vote_added" | "vote_removed" | "commented" | "flagged" | "moderated"; actorId?: string; createdAt: number; payload: Record<string, unknown> }): Promise<void> {
      await client.execute({ sql: "insert into events (id, item_id, type, actor_id, payload, created_at) values (?, ?, ?, ?, ?, ?)", args: [id("evt"), event.itemId, event.type, event.actorId ?? null, json(event.payload), event.createdAt] });
    },
    async listEvents(input: { itemId: string }) {
      const rows = (await client.execute({ sql: "select * from events where item_id = ? order by created_at, id", args: [input.itemId] })).rows;
      return rows.map((row) => ({ id: String(row.id), itemId: String(row.item_id), type: row.type as "created" | "state_changed" | "merged" | "vote_added" | "vote_removed" | "commented" | "flagged" | "moderated", ...(row.actor_id ? { actorId: String(row.actor_id) } : {}), createdAt: number(row.created_at), payload: parse<Record<string, unknown>>(row.payload, {}) }));
    },
    async publishChangelogEntry(input: ChangelogInput) {
      const board = await one(client, { sql: "select id from boards where id = ?", args: [input.boardId] });
      if (!board) throw new Error("Board not found.");
      for (const itemId of input.linkedItemIds) {
        const linked = await one(client, { sql: "select id from items where id = ? and board_id = ?", args: [itemId, input.boardId] });
        if (!linked) throw new Error("Changelog links must belong to its board.");
      }
      const now = Date.now(); const entry = { id: id("change"), boardId: input.boardId, title: input.title, slug: slug(input.title, input.title.slice(0, 8)), body: input.body, ...(input.version ? { version: input.version } : {}), linkedItemIds: input.linkedItemIds, ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}), createdAt: now };
      await client.execute({ sql: "insert into changelog_entries (id, board_id, title, slug, body, version, linked_item_ids, published_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [entry.id, entry.boardId, entry.title, entry.slug, entry.body, entry.version ?? null, json(entry.linkedItemIds), entry.publishedAt ?? null, entry.createdAt] });
      return entry;
    },
    async listChangelog(input: { boardId: string; cursor?: string; limit: number }) {
      const offset = input.cursor ? Number(input.cursor) : 0;
      const rows = (await client.execute({ sql: "select * from changelog_entries where board_id = ? order by created_at desc, id desc limit ? offset ?", args: [input.boardId, input.limit + 1, offset] })).rows;
      const hasMore = rows.length > input.limit;
      return { items: rows.slice(0, input.limit).map((row) => ({ id: String(row.id), boardId: String(row.board_id), title: String(row.title), slug: String(row.slug), body: String(row.body), ...(row.version ? { version: String(row.version) } : {}), linkedItemIds: parse<readonly string[]>(row.linked_item_ids, []), ...(row.published_at ? { publishedAt: number(row.published_at) } : {}), createdAt: number(row.created_at) })), nextCursor: hasMore ? String(offset + input.limit) : null };
    },
    async saveLane(input: LaneInput) {
      if (input.states.some((state) => !ITEM_STATES.includes(state) || state === "merged")) throw new Error("Invalid roadmap state.");
      const value = { id: input.id ?? id("lane"), boardId: input.boardId, name: input.name, states: input.states, order: input.order };
      await client.execute({ sql: "insert into roadmap_lanes (id, board_id, name, states, sort_order) values (?, ?, ?, ?, ?) on conflict(id) do update set name = excluded.name, states = excluded.states, sort_order = excluded.sort_order", args: [value.id, value.boardId, value.name, json(value.states), value.order] });
      return value;
    },
    async listLanes(input: { boardId: string }) {
      const rows = (await client.execute({ sql: "select * from roadmap_lanes where board_id = ? order by sort_order, id", args: [input.boardId] })).rows;
      return rows.map((row) => ({ id: String(row.id), boardId: String(row.board_id), name: String(row.name), states: parse<readonly ItemState[]>(row.states, []), order: number(row.sort_order) }));
    },
  };
}
