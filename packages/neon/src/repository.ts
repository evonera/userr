import { randomUUID } from "node:crypto";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";

import {
  ITEM_STATES,
  normalizeText,
  type Board,
  type BoardInput,
  type CursorPage,
  type FeedbackEvent,
  type FeedbackItem,
  type FeedbackRepository,
  type ItemInput,
  type ItemState,
  type MergePlan,
} from "@userr/core";

import * as schema from "./schema.js";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function slugify(title: string, publicId: string): string {
  const stem =
    normalizeText(title).replace(/ /g, "-").slice(0, 72) || "feedback";
  return `${stem}-${publicId.toLowerCase()}`;
}

function toBoard(row: typeof schema.boards.$inferSelect): Board {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    visibility: row.visibility === "private" ? "private" : "public",
    allowedKinds: row.allowedKinds as Board["allowedKinds"],
    statusOrder: row.statusOrder as Board["statusOrder"],
  };
}

function toItem(row: typeof schema.items.$inferSelect): FeedbackItem {
  return {
    id: row.id,
    boardId: row.boardId,
    publicId: row.publicId,
    slug: row.slug,
    title: row.title,
    body: row.body,
    kind: row.kind as FeedbackItem["kind"],
    state: row.state as FeedbackItem["state"],
    authorId: row.authorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    voteCount: row.voteCount,
    commentCount: row.commentCount,
    mergedInto: row.mergedInto ?? undefined,
    labels: row.labels,
    context:
      (row.context as FeedbackItem["context"]) ?? undefined,
  };
}

function toEvent(row: typeof schema.events.$inferSelect): FeedbackEvent {
  return {
    id: row.id,
    itemId: row.itemId,
    type: row.type as FeedbackEvent["type"],
    actorId: row.actorId ?? undefined,
    createdAt: row.createdAt,
    payload: row.payload,
  };
}

async function requireItem(
  db: Database,
  itemId: string,
): Promise<typeof schema.items.$inferSelect> {
  const rows = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) throw new Error("Feedback item not found.");
  return item;
}

export async function getBoard(
  db: Database,
  boardId: string,
): Promise<Board | null> {
  const rows = await db
    .select()
    .from(schema.boards)
    .where(eq(schema.boards.id, boardId))
    .limit(1);
  return rows[0] ? toBoard(rows[0]) : null;
}

export async function getBoardBySlug(
  db: Database,
  slug: string,
): Promise<Board | null> {
  const rows = await db
    .select()
    .from(schema.boards)
    .where(eq(schema.boards.slug, slug))
    .limit(1);
  return rows[0] ? toBoard(rows[0]) : null;
}

export async function getComment(
  db: Database,
  commentId: string,
): Promise<{
  id: string;
  itemId: string;
  actorId: string;
  body: string | null;
} | null> {
  const rows = await db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.id, commentId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.itemId,
    actorId: row.actorId,
    body: row.deletedAt ? null : row.body,
  };
}

/**
 * Postgres implementation of the shared `FeedbackRepository` contract.
 * Accepts any pg-dialect Drizzle database: `drizzle-orm/node-postgres` in
 * production (Neon), `drizzle-orm/pglite` in tests. Multi-step writes run
 * inside transactions; the unique vote constraint is the final arbiter of
 * vote uniqueness under concurrency.
 */
export function createRepository(db: Database): FeedbackRepository {
  return {
    async createBoard(input: BoardInput): Promise<Board> {
      const [row] = await db
        .insert(schema.boards)
        .values({
          id: newId("board"),
          slug: input.slug,
          name: input.name,
          visibility: input.visibility,
          allowedKinds: [...input.allowedKinds],
          statusOrder: [...input.statusOrder],
          createdAt: Date.now(),
        })
        .returning();
      if (!row) throw new Error("Board creation failed.");
      return toBoard(row);
    },

    async createItem(input: ItemInput): Promise<FeedbackItem> {
      const title = input.title.trim();
      if (title.length === 0) throw new Error("Title is required.");
      return db.transaction(async (tx) => {
        const board = await tx
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, input.boardId))
          .limit(1)
          .then((rows) => rows[0]);
        if (!board) throw new Error("Board not found.");
        if (!board.allowedKinds.includes(input.kind)) {
          throw new Error(`Kind "${input.kind}" is not allowed on this board.`);
        }
        const id = newId("item");
        const publicId = id.slice(-8).toUpperCase();
        const now = Date.now();
        const [row] = await tx
          .insert(schema.items)
          .values({
            id,
            boardId: input.boardId,
            publicId,
            slug: slugify(title, publicId),
            title,
            body: input.body,
            normalizedTitle: normalizeText(title),
            searchText: `${title}\n${input.body}`,
            kind: input.kind,
            state: "inbox",
            authorId: input.authorId,
            voteCount: 0,
            commentCount: 0,
            labels: [],
            context: input.context,
            embeddingState: "pending",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!row) throw new Error("Item creation failed.");
        await tx.insert(schema.events).values({
          id: newId("evt"),
          itemId: id,
          type: "created",
          actorId: input.authorId,
          payload: {},
          createdAt: now,
        });
        return toItem(row);
      });
    },

    async findItem(id: string): Promise<FeedbackItem | null> {
      const rows = await db
        .select()
        .from(schema.items)
        .where(eq(schema.items.id, id))
        .limit(1);
      return rows[0] ? toItem(rows[0]) : null;
    },

    async findCanonicalItem(id: string): Promise<FeedbackItem | null> {
      const item = await this.findItem(id);
      if (!item) return null;
      return this.findItem(item.mergedInto ?? item.id);
    },

    async listItems(input: {
      boardId: string;
      cursor?: string;
      limit: number;
      state?: ItemState;
    }): Promise<CursorPage<FeedbackItem>> {
      const conditions = [eq(schema.items.boardId, input.boardId)];
      if (input.state) conditions.push(eq(schema.items.state, input.state));
      if (input.cursor) {
        const decoded = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString("utf8"),
        ) as { createdAt: number; id: string };
        conditions.push(
          or(
            gt(schema.items.createdAt, decoded.createdAt),
            and(
              eq(schema.items.createdAt, decoded.createdAt),
              gt(schema.items.id, decoded.id),
            ),
          )!,
        );
      }
      const rows = await db
        .select()
        .from(schema.items)
        .where(and(...conditions))
        .orderBy(asc(schema.items.createdAt), asc(schema.items.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toItem),
        nextCursor:
          rows.length > input.limit && last
            ? Buffer.from(
                JSON.stringify({ createdAt: last.createdAt, id: last.id }),
              ).toString("base64url")
            : null,
      };
    },

    async castVote(input: { itemId: string; actorId: string }) {
      return db.transaction(async (tx) => {
        const item = await requireItem(tx as Database, input.itemId);
        if (item.mergedInto) throw new Error("Feedback item is unavailable.");
        const inserted = await tx
          .insert(schema.votes)
          .values({
            itemId: input.itemId,
            actorId: input.actorId,
            createdAt: Date.now(),
          })
          .onConflictDoNothing()
          .returning({ itemId: schema.votes.itemId });
        if (inserted.length === 0) {
          return { added: false, voteCount: item.voteCount };
        }
        const [updated] = await tx
          .update(schema.items)
          .set({
            // Atomic increment: never derive from a snapshot, or concurrent
            // votes overwrite each other (lost update).
            voteCount: sql`${schema.items.voteCount} + 1`,
            updatedAt: Date.now(),
          })
          .where(eq(schema.items.id, input.itemId))
          .returning({ voteCount: schema.items.voteCount });
        await tx.insert(schema.events).values({
          id: newId("evt"),
          itemId: input.itemId,
          type: "vote_added",
          actorId: input.actorId,
          payload: {},
          createdAt: Date.now(),
        });
        return { added: true, voteCount: updated?.voteCount ?? item.voteCount + 1 };
      });
    },

    async uncastVote(input: { itemId: string; actorId: string }) {
      return db.transaction(async (tx) => {
        const item = await requireItem(tx as Database, input.itemId);
        const deleted = await tx
          .delete(schema.votes)
          .where(
            and(
              eq(schema.votes.itemId, input.itemId),
              eq(schema.votes.actorId, input.actorId),
            ),
          )
          .returning({ itemId: schema.votes.itemId });
        if (deleted.length === 0) {
          return { removed: false, voteCount: item.voteCount };
        }
        const [updated] = await tx
          .update(schema.items)
          .set({
            voteCount: sql`greatest(0, ${schema.items.voteCount} - 1)`,
            updatedAt: Date.now(),
          })
          .where(eq(schema.items.id, input.itemId))
          .returning({ voteCount: schema.items.voteCount });
        await tx.insert(schema.events).values({
          id: newId("evt"),
          itemId: input.itemId,
          type: "vote_removed",
          actorId: input.actorId,
          payload: {},
          createdAt: Date.now(),
        });
        return {
          removed: true,
          voteCount: updated?.voteCount ?? Math.max(0, item.voteCount - 1),
        };
      });
    },

    async setState(input: {
      itemId: string;
      state: ItemState;
      actorId: string;
    }): Promise<void> {
      if (!ITEM_STATES.includes(input.state)) {
        throw new Error(`Invalid state "${input.state}".`);
      }
      if (input.state === "merged") {
        throw new Error(
          'State "merged" is set only by the merge operation, which establishes mergedInto.',
        );
      }
      await db.transaction(async (tx) => {
        const t = tx as Database;
        const item = await requireItem(t, input.itemId);
        if (item.mergedInto) {
          throw new Error("Merged items cannot change state.");
        }
        if (item.state === input.state) return;
        const now = Date.now();
        await t
          .update(schema.items)
          .set({ state: input.state, updatedAt: now })
          .where(eq(schema.items.id, input.itemId));
        await t.insert(schema.events).values({
          id: newId("evt"),
          itemId: input.itemId,
          type: "state_changed",
          actorId: input.actorId,
          payload: { from: item.state, to: input.state },
          createdAt: now,
        });
      });
    },

    async merge(plan: MergePlan): Promise<void> {
      await db.transaction(async (tx) => {
        const t = tx as Database;
        const source = await requireItem(t, plan.sourceId);
        const target = await requireItem(t, plan.targetId);
        if (
          source.boardId !== target.boardId ||
          source.mergedInto ||
          target.mergedInto
        ) {
          throw new Error("Invalid merge target.");
        }
        const now = Date.now();
        const sourceVotes = await t
          .select({ actorId: schema.votes.actorId })
          .from(schema.votes)
          .where(eq(schema.votes.itemId, plan.sourceId));
        const targetVotes = await t
          .select({ actorId: schema.votes.actorId })
          .from(schema.votes)
          .where(eq(schema.votes.itemId, plan.targetId));
        const targetVoters = new Set(targetVotes.map((v) => v.actorId));
        const fresh = sourceVotes.filter((v) => !targetVoters.has(v.actorId));
        // Increment by rows actually inserted, not by the snapshot count: a
        // concurrent vote on the target makes onConflictDoNothing skip a row,
        // and counting it would inflate voteCount past the distinct rows.
        let transferred = 0;
        if (fresh.length > 0) {
          const inserted = await t
            .insert(schema.votes)
            .values(
              fresh.map((v) => ({
                itemId: plan.targetId,
                actorId: v.actorId,
                createdAt: now,
              })),
            )
            .onConflictDoNothing()
            .returning({ actorId: schema.votes.actorId });
          transferred = inserted.length;
        }
        const sourceSubs = await t
          .select({ actorId: schema.subscriptions.actorId })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.itemId, plan.sourceId));
        const targetSubs = await t
          .select({ actorId: schema.subscriptions.actorId })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.itemId, plan.targetId));
        const targetSubscribers = new Set(targetSubs.map((s) => s.actorId));
        const freshSubs = sourceSubs.filter(
          (s) => !targetSubscribers.has(s.actorId),
        );
        if (freshSubs.length > 0) {
          await t
            .insert(schema.subscriptions)
            .values(
              freshSubs.map((s) => ({
                itemId: plan.targetId,
                actorId: s.actorId,
                notifyComments: true,
                notifyStatusChanges: true,
                createdAt: now,
              })),
            )
            .onConflictDoNothing();
        }
        await t
          .update(schema.items)
          .set({
            voteCount: sql`${schema.items.voteCount} + ${transferred}`,
            updatedAt: now,
          })
          .where(eq(schema.items.id, plan.targetId));
        await t
          .update(schema.items)
          .set({ state: "merged", mergedInto: plan.targetId, updatedAt: now })
          .where(eq(schema.items.id, plan.sourceId));
        await t.insert(schema.events).values({
          id: newId("evt"),
          itemId: plan.sourceId,
          type: "merged",
          actorId: plan.actorId,
          payload: { targetId: plan.targetId, reason: plan.reason },
          createdAt: now,
        });
      });
    },

    async appendEvent(event: Omit<FeedbackEvent, "id">): Promise<void> {
      await db.insert(schema.events).values({
        id: newId("evt"),
        itemId: event.itemId,
        type: event.type,
        actorId: event.actorId,
        payload: event.payload,
        createdAt: event.createdAt,
      });
    },

    async listEvents(input: {
      itemId: string;
    }): Promise<readonly FeedbackEvent[]> {
      const rows = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.itemId, input.itemId))
        .orderBy(asc(schema.events.createdAt), asc(schema.events.id));
      return rows.map(toEvent);
    },
  };
}

/** Lexical duplicate suggestions. Mirrors the component's `findSimilar`:
 *  exact normalized-title match plus substring candidates ranked by votes.
 *  No AI dependency; vector candidates are a separate call. */
export async function findSimilar(
  db: Database,
  input: { boardId: string; title: string; limit?: number },
): Promise<{
  exact: string | null;
  similar: { id: string; title: string; voteCount: number }[];
}> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const normalized = normalizeText(input.title);
  if (normalized.length === 0) return { exact: null, similar: [] };
  const exactCandidates = await db
    .select()
    .from(schema.items)
    .where(
      and(
        eq(schema.items.boardId, input.boardId),
        eq(schema.items.normalizedTitle, normalized),
      ),
    )
    .limit(5);
  const exactHit = exactCandidates.find((item) => !item.mergedInto);
  const exact = exactHit ? exactHit.id : null;
  const like = await db
    .select()
    .from(schema.items)
    .where(
      and(
        eq(schema.items.boardId, input.boardId),
        sql`position(${normalized} in ${schema.items.normalizedTitle}) > 0`,
      ),
    )
    .orderBy(desc(schema.items.voteCount))
    .limit(limit * 2);
  const similar = [];
  for (const candidate of like) {
    if (candidate.mergedInto) continue;
    if (exact !== null && candidate.id === exact) continue;
    similar.push({
      id: candidate.id,
      title: candidate.title,
      voteCount: candidate.voteCount,
    });
    if (similar.length >= limit) break;
  }
  return { exact, similar };
}

/** Vector duplicate candidates. The host embeds with its own provider and
 *  passes the vector in; pgvector cosine distance does the ranking. */
export async function findSimilarVector(
  db: Database,
  input: { boardId: string; embedding: number[]; limit?: number },
): Promise<{ id: string; title: string; voteCount: number }[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const literal = `[${input.embedding.join(",")}]`;
  const rows = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      voteCount: schema.items.voteCount,
      mergedInto: schema.items.mergedInto,
    })
    .from(schema.items)
    .where(eq(schema.items.boardId, input.boardId))
    .orderBy(sql`${schema.items.embedding} <=> ${literal}::vector`)
    .limit(limit * 2);
  return rows
    .filter((row) => !row.mergedInto)
    .slice(0, limit)
    .map((row) => ({ id: row.id, title: row.title, voteCount: row.voteCount }));
}

/** Items awaiting enrichment, for the host's scheduled embedding job. */
export async function pendingEnrichment(
  db: Database,
  input: { limit?: number } = {},
): Promise<{ itemId: string; text: string }[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const rows = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.embeddingState, "pending"))
    .limit(limit);
  return rows.map((row) => ({
    itemId: row.id,
    text: `${row.title}\n${row.body}`,
  }));
}

/** Store host-computed embeddings. Gated by the host's route layer. */
export async function storeEmbedding(
  db: Database,
  input: { itemId: string; embedding: number[] },
): Promise<void> {
  if (input.embedding.length === 0) {
    throw new Error("Embedding must not be empty.");
  }
  await requireItem(db, input.itemId);
  await db
    .update(schema.items)
    .set({
      embedding: input.embedding,
      embeddingState: "ready",
      updatedAt: Date.now(),
    })
    .where(eq(schema.items.id, input.itemId));
}

const MAX_COMMENT_DEPTH = 5;

async function commentDepth(
  db: Database,
  parentId: string | undefined,
): Promise<number> {
  let depth = 0;
  let current = parentId;
  while (current) {
    depth += 1;
    if (depth > MAX_COMMENT_DEPTH) break;
    const rows = await db
      .select({ itemId: schema.comments.itemId, parentId: schema.comments.parentId })
      .from(schema.comments)
      .where(eq(schema.comments.id, current))
      .limit(1);
    const parent = rows[0];
    if (!parent) throw new Error("Parent comment not found.");
    current = parent.parentId ?? undefined;
  }
  return depth;
}

export async function createComment(
  db: Database,
  input: { itemId: string; actorId: string; body: string; parentId?: string },
): Promise<string> {
  const body = input.body.trim();
  if (body.length === 0) throw new Error("Comment body is required.");
  return db.transaction(async (tx) => {
    const t = tx as Database;
    const item = await requireItem(t, input.itemId);
    if (item.mergedInto) throw new Error("Feedback item is unavailable.");
    if (input.parentId) {
      const parents = await t
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.id, input.parentId))
        .limit(1);
      const parent = parents[0];
      if (!parent || parent.itemId !== input.itemId || parent.deletedAt) {
        throw new Error("Parent comment is unavailable.");
      }
      if ((await commentDepth(t, input.parentId)) >= MAX_COMMENT_DEPTH) {
        throw new Error(`Replies are limited to ${MAX_COMMENT_DEPTH} levels.`);
      }
    }
    const now = Date.now();
    const [row] = await t
      .insert(schema.comments)
      .values({
        id: newId("comment"),
        itemId: input.itemId,
        actorId: input.actorId,
        body,
        parentId: input.parentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.comments.id });
    if (!row) throw new Error("Comment creation failed.");
    await t
      .update(schema.items)
      .set({
        commentCount: sql`${schema.items.commentCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.items.id, input.itemId));
    await t.insert(schema.events).values({
      id: newId("evt"),
      itemId: input.itemId,
      type: "commented",
      actorId: input.actorId,
      payload: { commentId: row.id },
      createdAt: now,
    });
    return row.id;
  });
}

export async function listComments(
  db: Database,
  input: { itemId: string; limit?: number; cursor?: string },
): Promise<{
  items: {
    id: string;
    itemId: string;
    actorId: string;
    body: string | null;
    parentId?: string;
    createdAt: number;
    updatedAt: number;
  }[];
  nextCursor: string | null;
}> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conditions = [eq(schema.comments.itemId, input.itemId)];
  if (input.cursor) {
    const decoded = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString("utf8"),
    ) as { createdAt: number; id: string };
    conditions.push(
      or(
        gt(schema.comments.createdAt, decoded.createdAt),
        and(
          eq(schema.comments.createdAt, decoded.createdAt),
          gt(schema.comments.id, decoded.id),
        ),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(schema.comments)
    .where(and(...conditions))
    .orderBy(asc(schema.comments.createdAt), asc(schema.comments.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      actorId: row.actorId,
      body: row.deletedAt ? null : row.body,
      parentId: row.parentId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.createdAt, id: last.id }),
          ).toString("base64url")
        : null,
  };
}

export async function removeComment(
  db: Database,
  input: { commentId: string; actorId: string; asModerator?: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as Database;
    const rows = await t
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, input.commentId))
      .limit(1);
    const comment = rows[0];
    if (!comment || comment.deletedAt) {
      throw new Error("Comment is unavailable.");
    }
    if (comment.actorId !== input.actorId && !input.asModerator) {
      throw new Error("Only the author can delete this comment.");
    }
    const now = Date.now();
    await t
      .update(schema.comments)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.comments.id, input.commentId));
    await requireItem(t, comment.itemId);
    await t
      .update(schema.items)
      .set({
        commentCount: sql`greatest(0, ${schema.items.commentCount} - 1)`,
        updatedAt: now,
      })
      .where(eq(schema.items.id, comment.itemId));
  });
}

export async function subscribe(
  db: Database,
  input: {
    itemId: string;
    actorId: string;
    notifyComments?: boolean;
    notifyStatusChanges?: boolean;
  },
): Promise<void> {
  await requireItem(db, input.itemId);
  const existing = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.itemId, input.itemId),
        eq(schema.subscriptions.actorId, input.actorId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
  if (existing) {
    await db
      .update(schema.subscriptions)
      .set({
        notifyComments: input.notifyComments ?? existing.notifyComments,
        notifyStatusChanges:
          input.notifyStatusChanges ?? existing.notifyStatusChanges,
      })
      .where(
        and(
          eq(schema.subscriptions.itemId, input.itemId),
          eq(schema.subscriptions.actorId, input.actorId),
        ),
      );
    return;
  }
  await db.insert(schema.subscriptions).values({
    itemId: input.itemId,
    actorId: input.actorId,
    notifyComments: input.notifyComments ?? true,
    notifyStatusChanges: input.notifyStatusChanges ?? true,
    createdAt: Date.now(),
  });
}

export async function unsubscribe(
  db: Database,
  input: { itemId: string; actorId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.itemId, input.itemId),
        eq(schema.subscriptions.actorId, input.actorId),
      ),
    )
    .returning({ itemId: schema.subscriptions.itemId });
  return deleted.length > 0;
}
