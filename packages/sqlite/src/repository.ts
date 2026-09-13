import { randomUUID } from "node:crypto";

import {
  ITEM_STATES,
  normalizeText,
  type Board,
  type BoardInput,
  type CursorPage,
  type FeedbackItem,
  type ItemInput,
  type ItemState,
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
  };
}
