import { describe, test } from "vitest";

import {
  runConformanceSuite,
  type Board,
  type BoardInput,
  type ChangelogEntry,
  type CursorPage,
  type Delivery,
  type FeedbackEvent,
  type FeedbackItem,
  type FeedbackRepository,
  type ItemInput,
  type ItemState,
  type MergePlan,
  type ModerationState,
  type RoadmapLane,
  type Webhook,
  type WebhookInput,
} from "@userr/core";
import { api } from "../src/component/_generated/api.js";
import { setup, type TestInstance } from "./setup.js";

/**
 * Phase 1 proof that the Convex component satisfies the shared domain
 * contract. Phase 2 (Neon) must run this same suite against Postgres before
 * claiming parity.
 */
function convexRepository(t: TestInstance): FeedbackRepository {
  async function collectEvents(itemId: string): Promise<FeedbackEvent[]> {
    const all: FeedbackEvent[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = (await t.query(api.items.events, {
        itemId: itemId as never,
        paginationOpts: { numItems: 50, cursor },
      })) as {
        page: FeedbackEvent[];
        isDone: boolean;
        continueCursor: string | null;
      };
      all.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return all;
  }

  return {
    async createBoard(input: BoardInput): Promise<Board> {
      // Each test gets an isolated database, so the requested slug is safe.
      const id = (await t.mutation(api.boards.create, {
        slug: input.slug,
        name: input.name,
        visibility: input.visibility,
        allowedKinds: [...input.allowedKinds],
        statusOrder: [...input.statusOrder],
      })) as string;
      const doc = (await t.query(api.boards.get, {
        boardId: id as never,
      })) as Record<string, unknown> | null;
      if (!doc) throw new Error("board creation failed");
      const { _id, _creationTime, ...rest } = doc;
      void _creationTime;
      return { id: _id, ...rest } as Board;
    },
    async createItem(input: ItemInput): Promise<FeedbackItem> {
      const id = (await t.mutation(api.items.create, {
        boardId: input.boardId as never,
        actorId: input.authorId,
        title: input.title,
        body: input.body,
        kind: input.kind,
        ...(input.context ? { context: input.context } : {}),
      })) as string;
      const found = await this.findItem(id);
      if (!found) throw new Error("item creation failed");
      return found;
    },
    async findItem(id: string): Promise<FeedbackItem | null> {
      const got = (await t.query(api.items.get, {
        itemId: id as never,
      })) as { item: Record<string, unknown> } | null;
      if (!got) return null;
      const { _id, _creationTime, embedding, ...rest } = got.item;
      void _creationTime;
      void embedding;
      return { id: _id, ...rest } as FeedbackItem;
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
    }): Promise<CursorPage<FeedbackItem>> {
      const page = (await t.query(api.items.list, {
        boardId: input.boardId as never,
        ...(input.state ? { state: input.state as never } : {}),
        ...(input.moderation ? { moderation: input.moderation as never } : {}),
        paginationOpts: { numItems: input.limit, cursor: input.cursor ?? null },
      })) as {
        page: Record<string, unknown>[];
        isDone: boolean;
        continueCursor: string | null;
      };
      return {
        items: page.page.map((doc) => {
          const { _id, _creationTime, embedding, ...rest } = doc;
          void _creationTime;
          void embedding;
          return { id: _id, ...rest } as FeedbackItem;
        }),
        nextCursor: page.isDone ? null : page.continueCursor,
      };
    },
    async castVote(input: { itemId: string; actorId: string }) {
      return (await t.mutation(api.items.vote, {
        itemId: input.itemId as never,
        actorId: input.actorId,
      })) as { added: boolean; voteCount: number };
    },
    async uncastVote(input: { itemId: string; actorId: string }) {
      return (await t.mutation(api.items.unvote, {
        itemId: input.itemId as never,
        actorId: input.actorId,
      })) as { removed: boolean; voteCount: number };
    },
    async setState(input: {
      itemId: string;
      state: ItemState;
      actorId: string;
    }): Promise<void> {
      await t.mutation(api.items.setState, {
        itemId: input.itemId as never,
        state: input.state as never,
        actorId: input.actorId,
      });
    },
    async setStateMany(input: {
      itemIds: readonly string[];
      state: ItemState;
      actorId: string;
    }) {
      return (await t.mutation(api.items.setStateMany, {
        itemIds: input.itemIds as never,
        state: input.state as never,
        actorId: input.actorId,
      })) as { updated: number };
    },
    async reportItem(input: {
      itemId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      await t.mutation(api.moderation.report, {
        itemId: input.itemId as never,
        actorId: input.actorId,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    },
    async reviewItem(input: {
      itemId: string;
      decision: Exclude<ModerationState, "pending">;
      actorId: string;
    }): Promise<void> {
      await t.mutation(api.moderation.review, {
        itemId: input.itemId as never,
        decision: input.decision as never,
        actorId: input.actorId,
      });
    },
    async blockActor(input: {
      boardId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      await t.mutation(api.moderation.block, {
        boardId: input.boardId as never,
        actorId: input.actorId,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    },
    async unblockActor(input: {
      boardId: string;
      actorId: string;
    }): Promise<void> {
      await t.mutation(api.moderation.unblock, {
        boardId: input.boardId as never,
        actorId: input.actorId,
      });
    },
    async isBlocked(input: {
      boardId: string;
      actorId: string;
    }): Promise<boolean> {
      return (await t.query(api.moderation.isBlocked, {
        boardId: input.boardId as never,
        actorId: input.actorId,
      })) as boolean;
    },
    async setStateMany(input: {
      itemIds: readonly string[];
      state: ItemState;
      actorId: string;
    }) {
      return (await t.mutation(api.items.setStateMany, {
        itemIds: input.itemIds as never,
        state: input.state as never,
        actorId: input.actorId,
      })) as { updated: number };
    },
    async reportItem(input: {
      itemId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      await t.mutation(api.moderation.report, {
        itemId: input.itemId as never,
        actorId: input.actorId,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    },
    async reviewItem(input: {
      itemId: string;
      decision: Exclude<ModerationState, "pending">;
      actorId: string;
    }): Promise<void> {
      await t.mutation(api.moderation.review, {
        itemId: input.itemId as never,
        decision: input.decision as never,
        actorId: input.actorId,
      });
    },
    async blockActor(input: {
      boardId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      await t.mutation(api.moderation.block, {
        boardId: input.boardId as never,
        actorId: input.actorId,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    },
    async unblockActor(input: {
      boardId: string;
      actorId: string;
    }): Promise<void> {
      await t.mutation(api.moderation.unblock, {
        boardId: input.boardId as never,
        actorId: input.actorId,
      });
    },
    async isBlocked(input: {
      boardId: string;
      actorId: string;
    }): Promise<boolean> {
      return (await t.query(api.moderation.isBlocked, {
        boardId: input.boardId as never,
        actorId: input.actorId,
      })) as boolean;
    },
    async merge(plan: MergePlan): Promise<void> {
      await t.mutation(api.items.merge, {
        sourceId: plan.sourceId as never,
        targetId: plan.targetId as never,
        actorId: plan.actorId,
        ...(plan.reason ? { reason: plan.reason } : {}),
      });
    },
    async appendEvent(event: Omit<FeedbackEvent, "id">): Promise<void> {
      await t.mutation(api.items.recordEvent, {
        itemId: event.itemId as never,
        type: event.type,
        ...(event.actorId ? { actorId: event.actorId } : {}),
        payload: event.payload,
      });
    },
    async listEvents(input: {
      itemId: string;
    }): Promise<readonly FeedbackEvent[]> {
      return collectEvents(input.itemId);
    },
    async publishChangelogEntry(input) {
      const id = (await t.mutation(api.changelog.publish, {
        boardId: input.boardId as never,
        title: input.title,
        body: input.body,
        ...(input.version ? { version: input.version } : {}),
        linkedItemIds: [...input.linkedItemIds] as never,
        ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      })) as string;
      const page = (await t.query(api.changelog.list, {
        boardId: input.boardId as never,
        paginationOpts: { numItems: 50, cursor: null },
      })) as { page: Record<string, unknown>[] };
      const doc = page.page.find((entry) => entry._id === id);
      if (!doc) throw new Error("changelog entry creation failed");
      const { _id, _creationTime, ...rest } = doc;
      void _creationTime;
      return { id: _id, ...rest } as ChangelogEntry;
    },
    async listChangelog(input) {
      const page = (await t.query(api.changelog.list, {
        boardId: input.boardId as never,
        paginationOpts: {
          numItems: input.limit,
          cursor: input.cursor ?? null,
        },
      })) as {
        page: Record<string, unknown>[];
        isDone: boolean;
        continueCursor: string | null;
      };
      return {
        items: page.page.map((doc) => {
          const { _id, _creationTime, ...rest } = doc;
          void _creationTime;
          return { id: _id, ...rest } as ChangelogEntry;
        }),
        nextCursor: page.isDone ? null : page.continueCursor,
      };
    },
    async saveLane(input) {
      const id = (await t.mutation(api.roadmap.save, {
        ...(input.id ? { id: input.id as never } : {}),
        boardId: input.boardId as never,
        name: input.name,
        states: [...input.states],
        order: input.order,
      })) as string;
      const lanes = (await t.query(api.roadmap.list, {
        boardId: input.boardId as never,
      })) as Record<string, unknown>[];
      const doc = lanes.find((lane) => lane._id === id);
      if (!doc) throw new Error("lane save failed");
      const { _id, _creationTime, ...rest } = doc;
      void _creationTime;
      return { id: _id, ...rest } as RoadmapLane;
    },
    async listLanes(input) {
      const lanes = (await t.query(api.roadmap.list, {
        boardId: input.boardId as never,
      })) as Record<string, unknown>[];
      return lanes.map((doc) => {
        const { _id, _creationTime, ...rest } = doc;
        void _creationTime;
        return { id: _id, ...rest } as RoadmapLane;
      });
    },
    async createWebhook(input: WebhookInput) {
      const created = (await t.mutation(api.webhooks.create, {
        boardId: input.boardId as never,
        url: input.url,
        events: [...input.events] as never,
      })) as { id: string; secret: string };
      const hooks = (await t.query(api.webhooks.list, {
        boardId: input.boardId as never,
      })) as (Record<string, unknown> & { _id: string })[];
      const doc = hooks.find((hook) => hook._id === created.id);
      if (!doc) throw new Error("webhook creation failed");
      const { _id, _creationTime, ...rest } = doc;
      void _creationTime;
      return {
        webhook: { id: _id, ...rest } as Webhook,
        secret: created.secret,
      };
    },
    async listWebhooks(input: { boardId: string }) {
      const hooks = (await t.query(api.webhooks.list, {
        boardId: input.boardId as never,
      })) as Record<string, unknown>[];
      return hooks.map((doc) => {
        const { _id, _creationTime, ...rest } = doc;
        void _creationTime;
        return { id: _id, ...rest } as Webhook;
      });
    },
    async getWebhook(input: { id: string }) {
      const doc = (await t.query(api.webhooks.get, {
        id: input.id as never,
      })) as Record<string, unknown> | null;
      if (!doc) return null;
      const { _id, _creationTime, ...rest } = doc;
      void _creationTime;
      return { id: _id, ...rest } as Webhook;
    },
    async updateWebhook(input: {
      id: string;
      url?: string;
      events?: readonly never[];
      active?: boolean;
    }): Promise<void> {
      await t.mutation(api.webhooks.update, {
        id: input.id as never,
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      });
    },
    async rotateWebhookSecret(input: { id: string }) {
      return (await t.mutation(api.webhooks.rotateSecret, {
        id: input.id as never,
      })) as { secret: string };
    },
    async deleteWebhook(input: { id: string }): Promise<void> {
      await t.mutation(api.webhooks.remove, { id: input.id as never });
    },
    async listDeliveries(input: {
      webhookId?: string;
      status?: Delivery["status"];
      limit?: number;
    }) {
      const rows = (await t.query(api.webhooks.deliveries, {
        ...(input.webhookId ? { webhookId: input.webhookId as never } : {}),
        ...(input.status ? { status: input.status as never } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      })) as Record<string, unknown>[];
      return rows.map((doc) => {
        const { _id, _creationTime, ...rest } = doc;
        void _creationTime;
        return { id: _id, ...rest } as Delivery;
      });
    },
    async recordDeliveryOutcome(input: {
      deliveryId: string;
      ok: boolean;
      error?: string;
      at?: number;
    }) {
      void input.at;
      const deliveries = (await t.query(api.webhooks.deliveries, {
        limit: 200,
      })) as (Delivery & { _id: string })[];
      const before = deliveries.find((d) => d._id === input.deliveryId);
      if (!before) throw new Error("delivery must exist");
      await t.mutation(api.webhooks.recordOutcome, {
        deliveryId: input.deliveryId as never,
        ok: input.ok,
        ...(input.error ? { error: input.error } : {}),
      });
      const after = (
        (await t.query(api.webhooks.deliveries, { limit: 200 })) as (Delivery & {
          _id: string;
        })[]
      ).find((d) => d._id === input.deliveryId);
      if (!after) throw new Error("delivery must exist");
      const { _id, ...rest } = after;
      void _id;
      return rest;
    },
  };
}

describe("domain conformance", () => {
  test("Convex component passes the shared suite", async () => {
    const t = setup();
    await runConformanceSuite(convexRepository(t));
  });
});
