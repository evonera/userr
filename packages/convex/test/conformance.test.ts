import { describe, test } from "vitest";

import {
  runConformanceSuite,
  type Board,
  type BoardInput,
  type ChangelogEntry,
  type CursorPage,
  type FeedbackEvent,
  type FeedbackItem,
  type FeedbackRepository,
  type ItemInput,
  type ItemState,
  type MergePlan,
  type RoadmapLane,
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
    }): Promise<CursorPage<FeedbackItem>> {
      const page = (await t.query(api.items.list, {
        boardId: input.boardId as never,
        ...(input.state ? { state: input.state } : {}),
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
  };
}

describe("domain conformance", () => {
  test("Convex component passes the shared suite", async () => {
    const t = setup();
    await runConformanceSuite(convexRepository(t));
  });
});
