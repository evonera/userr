import { randomUUID } from "node:crypto";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";

import {
  assertSafeWebhookUrl,
  buildEnvelope,
  EMBEDDING_DIMENSIONS,
  generateWebhookSecret,
  ITEM_STATES,
  nextRetryAt,
  normalizeText,
  secretPreview,
  signWebhook,
  WEBHOOK_TIMEOUT_MS,
  VOTE_MILESTONES,
  type Board,
  type BoardInput,
  type ChangelogEntry,
  type ChangelogInput,
  type CursorPage,
  type Delivery,
  type FeedbackEvent,
  type FeedbackItem,
  type FeedbackRepository,
  type ItemInput,
  type ItemState,
  type LaneInput,
  type MergePlan,
  type ModerationState,
  type RoadmapLane,
  type Webhook,
  type WebhookEventType,
  type WebhookInput,
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
    moderation: row.moderation as FeedbackItem["moderation"],
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

function toChangelogEntry(
  row: typeof schema.changelogEntries.$inferSelect,
): ChangelogEntry {
  return {
    id: row.id,
    boardId: row.boardId,
    title: row.title,
    slug: row.slug,
    body: row.body,
    version: row.version ?? undefined,
    linkedItemIds: row.linkedItemIds,
    publishedAt: row.publishedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

function toLane(row: typeof schema.roadmapLanes.$inferSelect): RoadmapLane {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    states: row.states as RoadmapLane["states"],
    order: row.order,
  };
}

function maskWebhook(row: typeof schema.webhooks.$inferSelect): Webhook {
  return {
    id: row.id,
    boardId: row.boardId,
    url: row.url,
    secretPreview: secretPreview(row.secret),
    events: row.events as Webhook["events"],
    active: row.active,
    failureCount: row.failureCount,
    lastError: row.lastError ?? undefined,
    lastTriggeredAt: row.lastTriggeredAt ?? undefined,
  };
}

function toDelivery(row: typeof schema.deliveries.$inferSelect): Delivery {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event as Delivery["event"],
    payload: row.payload,
    status: row.status as Delivery["status"],
    attempts: row.attempts,
    nextRetryAt: row.nextRetryAt ?? undefined,
    lastError: row.lastError ?? undefined,
    deliveredAt: row.deliveredAt ?? undefined,
  };
}

/** Fan out to active webhooks subscribed to the event. Called inside the
 *  originating transaction so rows and outbox entries commit atomically. */
async function enqueueEvent(
  tx: Database,
  boardId: string,
  type: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const hooks = await tx
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.boardId, boardId));
  for (const hook of hooks) {
    if (!hook.active || !hook.events.includes(type)) continue;
    await tx.insert(schema.deliveries).values({
      id: newId("dlv"),
      webhookId: hook.id,
      event: type,
      payload,
      status: "pending",
      attempts: 0,
      nextRetryAt: now,
      createdAt: now,
    });
    await tx
      .update(schema.webhooks)
      .set({ lastTriggeredAt: now })
      .where(eq(schema.webhooks.id, hook.id));
  }
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

async function requireUnblocked(
  db: Database,
  boardId: string,
  actorId: string,
): Promise<void> {
  const rows = await db
    .select({ boardId: schema.blockedActors.boardId })
    .from(schema.blockedActors)
    .where(
      and(
        eq(schema.blockedActors.boardId, boardId),
        eq(schema.blockedActors.actorId, actorId),
      ),
    )
    .limit(1);
  if (rows[0]) throw new Error("Permission denied: actor is blocked on this board.");
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
        const t = tx as Database;
        const board = await t
          .select()
          .from(schema.boards)
          .where(eq(schema.boards.id, input.boardId))
          .limit(1)
          .then((rows) => rows[0]);
        if (!board) throw new Error("Board not found.");
        await requireUnblocked(t, input.boardId, input.authorId);
        if (!board.allowedKinds.includes(input.kind)) {
          throw new Error(`Kind "${input.kind}" is not allowed on this board.`);
        }
        const id = newId("item");
        const publicId = id.slice(-8).toUpperCase();
        const now = Date.now();
        const [row] = await t
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
        await t.insert(schema.events).values({
          id: newId("evt"),
          itemId: id,
          type: "created",
          actorId: input.authorId,
          payload: {},
          createdAt: now,
        });
        await enqueueEvent(t, input.boardId, "post.created", {
          itemId: id,
          title,
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
      moderation?: ModerationState;
      // Public reads hide rejected/spam/pending by default; admin surfaces
      // pass includeModerated (or an explicit moderation filter) instead.
      includeModerated?: boolean;
    }): Promise<CursorPage<FeedbackItem>> {
      const conditions = [eq(schema.items.boardId, input.boardId)];
      if (input.state) conditions.push(eq(schema.items.state, input.state));
      if (input.moderation) {
        conditions.push(eq(schema.items.moderation, input.moderation));
      } else if (!input.includeModerated) {
        conditions.push(eq(schema.items.moderation, "approved"));
      }
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
        if (item.moderation === "rejected" || item.moderation === "spam") {
          throw new Error("Feedback item is unavailable.");
        }
        await requireUnblocked(tx as Database, item.boardId, input.actorId);
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
        const count = updated?.voteCount ?? item.voteCount + 1;
        if (VOTE_MILESTONES.includes(count)) {
          await enqueueEvent(tx as Database, item.boardId, "vote.milestone", {
            itemId: input.itemId,
            voteCount: count,
          });
        }
        return { added: true, voteCount: count };
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
        await enqueueEvent(t, item.boardId, "post.status_changed", {
          itemId: input.itemId,
          from: item.state,
          to: input.state,
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
        if (source.state === "shipped" || target.state === "merged") {
          throw new Error(
            "This merge would lose a completed or canonical record.",
          );
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
        await enqueueEvent(t, source.boardId, "post.merged", {
          sourceId: plan.sourceId,
          targetId: plan.targetId,
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

    async publishChangelogEntry(
      input: ChangelogInput,
    ): Promise<ChangelogEntry> {
      const title = input.title.trim();
      if (title.length === 0) throw new Error("Title is required.");
      return db.transaction(async (tx) => {
        const t = tx as Database;
        const boards = await t
          .select({ id: schema.boards.id })
          .from(schema.boards)
          .where(eq(schema.boards.id, input.boardId))
          .limit(1);
        if (!boards[0]) throw new Error("Board not found.");
        // Linked items must exist on this board: no dangling or cross-board refs.
        for (const itemId of input.linkedItemIds) {
          const rows = await t
            .select({ boardId: schema.items.boardId })
            .from(schema.items)
            .where(eq(schema.items.id, itemId))
            .limit(1);
          const item = rows[0];
          if (!item || item.boardId !== input.boardId) {
            throw new Error("Linked items must exist on this board.");
          }
        }
        const id = newId("entry");
        const now = Date.now();
        const [row] = await t
          .insert(schema.changelogEntries)
          .values({
            id,
            boardId: input.boardId,
            title,
            slug: `${slugify(title, id.slice(-8).toUpperCase())}`,
            body: input.body,
            version: input.version,
            linkedItemIds: [...input.linkedItemIds],
            publishedAt: input.publishedAt,
            createdAt: now,
          })
          .returning();
        if (!row) throw new Error("Changelog entry creation failed.");
        await enqueueEvent(t, input.boardId, "changelog.published", {
          entryId: id,
          title,
        });
        return toChangelogEntry(row);
      });
    },

    async listChangelog(input: {
      boardId: string;
      cursor?: string;
      limit: number;
    }): Promise<CursorPage<ChangelogEntry>> {
      const conditions = [
        eq(schema.changelogEntries.boardId, input.boardId),
      ];
      if (input.cursor) {
        const decoded = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString("utf8"),
        ) as { createdAt: number; id: string };
        conditions.push(
          or(
            lt(schema.changelogEntries.createdAt, decoded.createdAt),
            and(
              eq(schema.changelogEntries.createdAt, decoded.createdAt),
              lt(schema.changelogEntries.id, decoded.id),
            ),
          )!,
        );
      }
      const rows = await db
        .select()
        .from(schema.changelogEntries)
        .where(and(...conditions))
        .orderBy(
          desc(schema.changelogEntries.createdAt),
          desc(schema.changelogEntries.id),
        )
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toChangelogEntry),
        nextCursor:
          rows.length > input.limit && last
            ? Buffer.from(
                JSON.stringify({ createdAt: last.createdAt, id: last.id }),
              ).toString("base64url")
            : null,
      };
    },

    async saveLane(input: LaneInput): Promise<RoadmapLane> {
      const name = input.name.trim();
      if (name.length === 0) throw new Error("Lane name is required.");
      for (const state of input.states) {
        if (!ITEM_STATES.includes(state)) {
          throw new Error(`Invalid lane state "${state}".`);
        }
      }
      if (input.id) {
        const existing = await db
          .select()
          .from(schema.roadmapLanes)
          .where(eq(schema.roadmapLanes.id, input.id))
          .limit(1)
          .then((rows) => rows[0]);
        if (!existing || existing.boardId !== input.boardId) {
          throw new Error("Roadmap lane not found.");
        }
        const [row] = await db
          .update(schema.roadmapLanes)
          .set({ name, states: [...input.states], order: input.order })
          .where(eq(schema.roadmapLanes.id, input.id))
          .returning();
        if (!row) throw new Error("Roadmap lane update failed.");
        return toLane(row);
      }
      const [row] = await db
        .insert(schema.roadmapLanes)
        .values({
          id: newId("lane"),
          boardId: input.boardId,
          name,
          states: [...input.states],
          order: input.order,
        })
        .returning();
      if (!row) throw new Error("Roadmap lane creation failed.");
      return toLane(row);
    },

    async listLanes(input: {
      boardId: string;
    }): Promise<readonly RoadmapLane[]> {
      const rows = await db
        .select()
        .from(schema.roadmapLanes)
        .where(eq(schema.roadmapLanes.boardId, input.boardId))
        .orderBy(asc(schema.roadmapLanes.order), asc(schema.roadmapLanes.id));
      return rows.map(toLane);
    },

    async createWebhook(input: WebhookInput) {
      assertSafeWebhookUrl(input.url);
      const boards = await db
        .select({ id: schema.boards.id })
        .from(schema.boards)
        .where(eq(schema.boards.id, input.boardId))
        .limit(1);
      if (!boards[0]) throw new Error("Board not found.");
      const secret = generateWebhookSecret();
      const [row] = await db
        .insert(schema.webhooks)
        .values({
          id: newId("hook"),
          boardId: input.boardId,
          url: input.url,
          secret,
          events: [...input.events],
          active: true,
          failureCount: 0,
          createdAt: Date.now(),
        })
        .returning();
      if (!row) throw new Error("Webhook creation failed.");
      return { webhook: maskWebhook(row), secret };
    },

    async listWebhooks(input: { boardId: string }) {
      const rows = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.boardId, input.boardId));
      return rows.map(maskWebhook);
    },

    async getWebhook(input: { id: string }): Promise<Webhook | null> {
      const rows = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, input.id))
        .limit(1);
      return rows[0] ? maskWebhook(rows[0]) : null;
    },

    async updateWebhook(input: {
      id: string;
      url?: string;
      events?: readonly WebhookEventType[];
      active?: boolean;
    }): Promise<void> {
      const existing = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, input.id))
        .limit(1)
        .then((rows) => rows[0]);
      if (!existing) throw new Error("Webhook not found.");
      if (input.url !== undefined) assertSafeWebhookUrl(input.url);
      await db
        .update(schema.webhooks)
        .set({
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.events !== undefined ? { events: [...input.events] } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(schema.webhooks.id, input.id));
    },

    async rotateWebhookSecret(input: { id: string }) {
      const existing = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, input.id))
        .limit(1)
        .then((rows) => rows[0]);
      if (!existing) throw new Error("Webhook not found.");
      const secret = generateWebhookSecret();
      await db
        .update(schema.webhooks)
        .set({ secret, failureCount: 0 })
        .where(eq(schema.webhooks.id, input.id));
      return { secret };
    },

    async deleteWebhook(input: { id: string }): Promise<void> {
      const deleted = await db
        .delete(schema.webhooks)
        .where(eq(schema.webhooks.id, input.id))
        .returning({ id: schema.webhooks.id });
      if (deleted.length === 0) throw new Error("Webhook not found.");
      await db
        .delete(schema.deliveries)
        .where(eq(schema.deliveries.webhookId, input.id));
    },

    async listDeliveries(input: {
      webhookId?: string;
      status?: Delivery["status"];
      limit?: number;
    }) {
      const conditions = [];
      if (input.webhookId) {
        conditions.push(eq(schema.deliveries.webhookId, input.webhookId));
      }
      if (input.status) {
        conditions.push(eq(schema.deliveries.status, input.status));
      }
      const rows = await db
        .select()
        .from(schema.deliveries)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.deliveries.createdAt))
        .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
      return rows.map(toDelivery);
    },

    async recordDeliveryOutcome(input: {
      deliveryId: string;
      ok: boolean;
      error?: string;
      at?: number;
      leaseOwner?: string;
    }) {
      return db.transaction(async (tx) => {
        const t = tx as Database;
        const rows = await t
          .select()
          .from(schema.deliveries)
          .where(eq(schema.deliveries.id, input.deliveryId))
          .limit(1);
        const delivery = rows[0];
        if (!delivery) throw new Error("Delivery not found.");
        const now = input.at ?? Date.now();
        // Leases are advisory for direct callers but binding between workers:
        // a live lease owned by someone else rejects the outcome.
        if (
          delivery.leaseOwner &&
          (delivery.leaseExpiresAt ?? 0) > now &&
          input.leaseOwner !== delivery.leaseOwner
        ) {
          throw new Error("Delivery lease held by another worker.");
        }
        const attempts = delivery.attempts + 1;
        if (input.ok) {
          const [row] = await t
            .update(schema.deliveries)
            .set({
              status: "delivered",
              attempts,
              deliveredAt: now,
              lastError: null,
            })
            .where(eq(schema.deliveries.id, input.deliveryId))
            .returning();
          await t
            .update(schema.webhooks)
            .set({ failureCount: 0, lastTriggeredAt: now })
            .where(eq(schema.webhooks.id, delivery.webhookId));
          return toDelivery(row ?? { ...delivery, status: "delivered", attempts });
        }
        const retryAt = nextRetryAt(attempts, now);
        if (retryAt === null) {
          const [row] = await t
            .update(schema.deliveries)
            .set({
              status: "failed",
              attempts,
              nextRetryAt: null,
              lastError: input.error ?? "delivery failed",
            })
            .where(eq(schema.deliveries.id, input.deliveryId))
            .returning();
          await t
            .update(schema.webhooks)
            .set({
              failureCount: sql`${schema.webhooks.failureCount} + 1`,
              active: false,
              lastError: input.error ?? "delivery failed",
            })
            .where(eq(schema.webhooks.id, delivery.webhookId));
          return toDelivery(row ?? { ...delivery, status: "failed", attempts });
        }
        const [row] = await t
          .update(schema.deliveries)
          .set({
            attempts,
            nextRetryAt: retryAt,
            lastError: input.error ?? "delivery failed",
          })
          .where(eq(schema.deliveries.id, input.deliveryId))
          .returning();
        await t
          .update(schema.webhooks)
          .set({
            failureCount: sql`${schema.webhooks.failureCount} + 1`,
            lastError: input.error ?? "delivery failed",
          })
          .where(eq(schema.webhooks.id, delivery.webhookId));
        return toDelivery(row ?? { ...delivery, attempts });
      });
    },

    async setStateMany(input: {
      itemIds: readonly string[];
      state: ItemState;
      actorId: string;
    }) {
      if (!ITEM_STATES.includes(input.state)) {
        throw new Error(`Invalid state "${input.state}".`);
      }
      if (input.state === "merged") {
        throw new Error(
          'State "merged" is set only by the merge operation, which establishes mergedInto.',
        );
      }
      if (input.itemIds.length === 0) return { updated: 0 };
      if (input.itemIds.length > 50) {
        throw new Error("Bulk updates are limited to 50 items.");
      }
      // Deduplicate first: repeating an id must produce one audit event and
      // one notification, not N.
      const ids = [...new Set(input.itemIds)];
      return db.transaction(async (tx) => {
        const t = tx as Database;
        // Validate everything before writing anything: all-or-nothing.
        const targets = [];
        for (const itemId of ids) {
          const item = await requireItem(t, itemId);
          if (item.mergedInto) {
            throw new Error(`Item ${itemId} is merged and cannot change state.`);
          }
          targets.push(item);
        }
        const now = Date.now();
        let updated = 0;
        for (const item of targets) {
          if (item.state === input.state) continue;
          await t
            .update(schema.items)
            .set({ state: input.state, updatedAt: now })
            .where(eq(schema.items.id, item.id));
          await t.insert(schema.events).values({
            id: newId("evt"),
            itemId: item.id,
            type: "state_changed",
            actorId: input.actorId,
            payload: { from: item.state, to: input.state },
            createdAt: now,
          });
          await enqueueEvent(t, item.boardId, "post.status_changed", {
            itemId: item.id,
            from: item.state,
            to: input.state,
          });
          updated += 1;
        }
        return { updated };
      });
    },

    async reportItem(input: {
      itemId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      await requireItem(db, input.itemId);
      const now = Date.now();
      await db.transaction(async (tx) => {
        const t = tx as Database;
        await t
          .update(schema.items)
          .set({ moderation: "pending", updatedAt: now })
          .where(eq(schema.items.id, input.itemId));
        await t.insert(schema.events).values({
          id: newId("evt"),
          itemId: input.itemId,
          type: "flagged",
          actorId: input.actorId,
          payload: input.reason ? { reason: input.reason } : {},
          createdAt: now,
        });
      });
    },

    async reviewItem(input: {
      itemId: string;
      decision: Exclude<ModerationState, "pending">;
      actorId: string;
    }): Promise<void> {
      const item = await requireItem(db, input.itemId);
      const now = Date.now();
      await db.transaction(async (tx) => {
        const t = tx as Database;
        await t
          .update(schema.items)
          .set({ moderation: input.decision, updatedAt: now })
          .where(eq(schema.items.id, input.itemId));
        await t.insert(schema.events).values({
          id: newId("evt"),
          itemId: input.itemId,
          type: "moderated",
          actorId: input.actorId,
          payload: { from: item.moderation, to: input.decision },
          createdAt: now,
        });
      });
    },

    async blockActor(input: {
      boardId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      await db
        .insert(schema.blockedActors)
        .values({
          boardId: input.boardId,
          actorId: input.actorId,
          reason: input.reason,
          createdAt: Date.now(),
        })
        .onConflictDoNothing();
    },

    async unblockActor(input: {
      boardId: string;
      actorId: string;
    }): Promise<void> {
      await db
        .delete(schema.blockedActors)
        .where(
          and(
            eq(schema.blockedActors.boardId, input.boardId),
            eq(schema.blockedActors.actorId, input.actorId),
          ),
        );
    },

    async isBlocked(input: {
      boardId: string;
      actorId: string;
    }): Promise<boolean> {
      const rows = await db
        .select({ boardId: schema.blockedActors.boardId })
        .from(schema.blockedActors)
        .where(
          and(
            eq(schema.blockedActors.boardId, input.boardId),
            eq(schema.blockedActors.actorId, input.actorId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}

/** Lexical duplicate suggestions. Mirrors the component's `findSimilar`:
 *  exact normalized-title match plus substring candidates ranked by votes.
 *  No AI dependency; vector candidates are a separate call. */
export async function findSimilar(
  db: Database,
  input: { boardId: string; title: string; limit?: number; includeModerated?: boolean },
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
  const visible = (moderation: string) =>
    input.includeModerated || moderation === "approved";
  const exactHit = exactCandidates.find(
    (item) => !item.mergedInto && visible(item.moderation),
  );
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
    if (!visible(candidate.moderation)) continue;
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
  if (input.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${input.embedding.length}.`,
    );
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
    if (item.moderation === "rejected" || item.moderation === "spam") {
      throw new Error("Feedback item is unavailable.");
    }
    await requireUnblocked(t, item.boardId, input.actorId);
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
    await enqueueEvent(t, item.boardId, "comment.created", {
      itemId: input.itemId,
      commentId: row.id,
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

export interface ProcessOutboxOptions {
  deliver?: (input: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  fetchImpl?: typeof fetch;
  limit?: number;
  now?: number;
  /** Per-request timeout in ms (default 10s). Slow endpoints fail the
   *  attempt instead of stalling the batch. */
  timeoutMs?: number;
  /** Lease duration in ms for claimed rows (default 60s). */
  leaseMs?: number;
}

/**
 * Host-run outbox worker. The host schedules this (cron, interval, queue
 * worker) with its own runtime: reads due deliveries, POSTs signed envelopes
 * via the injected deliver function (default uses global fetch), and records
 * outcomes with the shared retry schedule. Keeps secrets and scheduling in
 * host infrastructure — the adapter only defines the protocol.
 */
export async function processOutbox(
  db: Database,
  options: ProcessOutboxOptions = {},
): Promise<{ attempted: number; delivered: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const leaseMs = options.leaseMs ?? 60_000;
  const owner = `worker-${now}-${Math.floor(Math.random() * 1e9)}`;
  // Atomic claim: only rows without a live lease move to this worker, so
  // overlapping workers never send the same delivery twice.
  const due = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: schema.deliveries.id })
      .from(schema.deliveries)
      .where(
        and(
          eq(schema.deliveries.status, "pending"),
          sql`${schema.deliveries.nextRetryAt} <= ${now}`,
          or(
            sql`${schema.deliveries.leaseOwner} IS NULL`,
            sql`${schema.deliveries.leaseExpiresAt} <= ${now}`,
          ),
        ),
      )
      .limit(limit);
    if (candidates.length === 0) return [];
    return tx
      .update(schema.deliveries)
      .set({ leaseOwner: owner, leaseExpiresAt: now + leaseMs })
      .where(
        and(
          eq(schema.deliveries.status, "pending"),
          sql`${schema.deliveries.id} IN (${sql.join(
            candidates.map((c) => c.id),
            sql`, `,
          )})`,
          or(
            sql`${schema.deliveries.leaseOwner} IS NULL`,
            sql`${schema.deliveries.leaseExpiresAt} <= ${now}`,
          ),
        ),
      )
      .returning();
  });
  const deliver =
    options.deliver ??
    (async ({ url, headers, body }) => {
      const impl = options.fetchImpl ?? fetch;
      try {
        const res = await impl(url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers,
          body,
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "delivery failed",
        };
      }
    });

  let delivered = 0;
  const repo = createRepository(db);
  for (const delivery of due) {
    const hooks = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, delivery.webhookId))
      .limit(1);
    const hook = hooks[0];
    if (!hook || !hook.active) {
      await repo.recordDeliveryOutcome({
        deliveryId: delivery.id,
        ok: false,
        error: "webhook missing or inactive",
        at: now,
        leaseOwner: owner,
      });
      continue;
    }
    const boards = await db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, hook.boardId))
      .limit(1);
    const board = boards[0];
    const envelope = buildEnvelope({
      deliveryId: delivery.id,
      type: delivery.event as WebhookEventType,
      occurredAt: delivery.createdAt,
      board: board
        ? { id: board.id, slug: board.slug, name: board.name }
        : { id: hook.boardId, slug: "", name: "" },
      data:
        typeof delivery.payload === "object" && delivery.payload !== null
          ? (delivery.payload as Record<string, unknown>)
          : {},
    });
    const body = JSON.stringify(envelope);
    // Transport exceptions from injected callbacks become failed outcomes —
    // never an escaped throw that skips the batch or the retry schedule.
    let result: { ok: boolean; error?: string };
    try {
      result = await deliver({
        url: hook.url,
        headers: {
          "content-type": "application/json",
          "X-Feedback-Signature": await signWebhook(hook.secret, body),
          "X-Feedback-Event": delivery.event,
          "X-Feedback-Delivery": delivery.id,
        },
        body,
      });
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : "delivery failed",
      };
    }
    await repo.recordDeliveryOutcome({
      deliveryId: delivery.id,
      ok: result.ok,
      error: result.error,
      at: now,
      leaseOwner: owner,
    });
    if (result.ok) delivered += 1;
  }
  return { attempted: due.length, delivered };
}
