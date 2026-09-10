import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { runConformanceSuite } from "./conformance.js";
import { ITEM_STATES } from "./rules.js";
import type {
  Board,
  BoardInput,
  ChangelogEntry,
  ChangelogInput,
  CursorPage,
  FeedbackEvent,
  FeedbackItem,
  FeedbackRepository,
  ItemInput,
  ItemState,
  LaneInput,
  MergePlan,
  RoadmapLane,
} from "./types.js";

/** Minimal in-memory adapter. Exists only to prove the conformance suite itself
 *  is sound; backend adapters run the same suite against real storage. */
function createMemoryRepository(): FeedbackRepository {
  let seq = 0;
  const boards = new Map<string, Board>();
  const items = new Map<string, FeedbackItem>();
  const votes = new Map<string, Set<string>>();
  const events: FeedbackEvent[] = [];
  const changelog = new Map<string, ChangelogEntry>();
  const lanes = new Map<string, RoadmapLane>();
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  return {
    async createBoard(input: BoardInput): Promise<Board> {
      const board: Board = { id: nextId("board"), ...input };
      boards.set(board.id, board);
      return board;
    },
    async createItem(input: ItemInput): Promise<FeedbackItem> {
      const now = Date.now();
      const id = nextId("item");
      const item: FeedbackItem = {
        id,
        boardId: input.boardId,
        publicId: id.slice(-8).toUpperCase(),
        slug: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}`,
        title: input.title,
        body: input.body,
        kind: input.kind,
        state: "inbox",
        authorId: input.authorId,
        createdAt: now,
        updatedAt: now,
        voteCount: 0,
        commentCount: 0,
        labels: [],
        context: input.context,
      };
      items.set(id, item);
      votes.set(id, new Set());
      events.push({
        id: nextId("evt"),
        itemId: id,
        type: "created",
        actorId: input.authorId,
        createdAt: now,
        payload: {},
      });
      return item;
    },
    async findItem(id: string): Promise<FeedbackItem | null> {
      return items.get(id) ?? null;
    },
    async findCanonicalItem(id: string): Promise<FeedbackItem | null> {
      const item = items.get(id);
      if (!item) return null;
      return items.get(item.mergedInto ?? item.id) ?? null;
    },
    async listItems(input: {
      boardId: string;
      cursor?: string;
      limit: number;
      state?: ItemState;
    }): Promise<CursorPage<FeedbackItem>> {
      const all = [...items.values()]
        .filter((item) => item.boardId === input.boardId)
        .filter((item) => !input.state || item.state === input.state)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const start = input.cursor ? Number(input.cursor) : 0;
      const page = all.slice(start, start + input.limit);
      const next = start + input.limit;
      return {
        items: page,
        nextCursor: next < all.length ? String(next) : null,
      };
    },
    async castVote(input: { itemId: string; actorId: string }) {
      const item = items.get(input.itemId);
      assert.ok(item, "item must exist to vote");
      const voters = votes.get(input.itemId) ?? new Set<string>();
      if (voters.has(input.actorId)) {
        return { added: false, voteCount: item.voteCount };
      }
      voters.add(input.actorId);
      votes.set(input.itemId, voters);
      item.voteCount += 1;
      events.push({
        id: nextId("evt"),
        itemId: input.itemId,
        type: "vote_added",
        actorId: input.actorId,
        createdAt: Date.now(),
        payload: {},
      });
      return { added: true, voteCount: item.voteCount };
    },
    async uncastVote(input: { itemId: string; actorId: string }) {
      const item = items.get(input.itemId);
      assert.ok(item, "item must exist to unvote");
      const voters = votes.get(input.itemId) ?? new Set<string>();
      if (!voters.has(input.actorId)) {
        return { removed: false, voteCount: item.voteCount };
      }
      voters.delete(input.actorId);
      item.voteCount -= 1;
      events.push({
        id: nextId("evt"),
        itemId: input.itemId,
        type: "vote_removed",
        actorId: input.actorId,
        createdAt: Date.now(),
        payload: {},
      });
      return { removed: true, voteCount: item.voteCount };
    },
    async setState(input: {
      itemId: string;
      state: ItemState;
      actorId: string;
    }): Promise<void> {
      const item = items.get(input.itemId);
      assert.ok(item, "item must exist to change state");
      if (!ITEM_STATES.includes(input.state)) {
        throw new Error(`Invalid state "${input.state}".`);
      }
      if (input.state === "merged") {
        throw new Error(
          'State "merged" is set only by the merge operation, which establishes mergedInto.',
        );
      }
      if (item.mergedInto) throw new Error("Merged items cannot change state.");
      if (item.state === input.state) return;
      const from = item.state;
      item.state = input.state;
      item.updatedAt = Date.now();
      events.push({
        id: nextId("evt"),
        itemId: input.itemId,
        type: "state_changed",
        actorId: input.actorId,
        createdAt: Date.now(),
        payload: { from, to: input.state },
      });
    },
    async merge(plan: MergePlan): Promise<void> {
      const source = items.get(plan.sourceId);
      const target = items.get(plan.targetId);
      assert.ok(source && target, "merge endpoints must exist");
      if (source.state === "shipped" || target.state === "merged") {
        throw new Error("This merge would lose a completed or canonical record.");
      }
      const sourceVoters = votes.get(plan.sourceId) ?? new Set<string>();
      const targetVoters = votes.get(plan.targetId) ?? new Set<string>();
      for (const voter of sourceVoters) {
        if (!targetVoters.has(voter)) {
          targetVoters.add(voter);
          target.voteCount += 1;
        }
      }
      source.state = "merged";
      source.mergedInto = plan.targetId;
      source.updatedAt = plan.mergedAt;
      events.push({
        id: nextId("evt"),
        itemId: plan.sourceId,
        type: "merged",
        actorId: plan.actorId,
        createdAt: plan.mergedAt,
        payload: { targetId: plan.targetId, reason: plan.reason },
      });
    },
    async appendEvent(event: Omit<FeedbackEvent, "id">): Promise<void> {
      events.push({ ...event, id: nextId("evt") });
    },
    async listEvents(input: {
      itemId: string;
    }): Promise<readonly FeedbackEvent[]> {
      return events.filter((event) => event.itemId === input.itemId);
    },
    async publishChangelogEntry(
      input: ChangelogInput,
    ): Promise<ChangelogEntry> {
      const now = Date.now();
      const id = nextId("entry");
      const entry: ChangelogEntry = {
        id,
        boardId: input.boardId,
        title: input.title,
        slug: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 72)}-${id}`,
        body: input.body,
        version: input.version,
        linkedItemIds: [...input.linkedItemIds],
        publishedAt: input.publishedAt,
        createdAt: now,
      };
      changelog.set(id, entry);
      return entry;
    },
    async listChangelog(input: {
      boardId: string;
      cursor?: string;
      limit: number;
    }): Promise<CursorPage<ChangelogEntry>> {
      const all = [...changelog.values()]
        .filter((entry) => entry.boardId === input.boardId)
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      const start = input.cursor ? Number(input.cursor) : 0;
      const page = all.slice(start, start + input.limit);
      const next = start + input.limit;
      return {
        items: page,
        nextCursor: next < all.length ? String(next) : null,
      };
    },
    async saveLane(input: LaneInput): Promise<RoadmapLane> {
      if (input.id) {
        const lane = lanes.get(input.id);
        assert.ok(lane, "lane must exist to update");
        const updated: RoadmapLane = {
          ...lane,
          name: input.name,
          states: [...input.states],
          order: input.order,
        };
        lanes.set(input.id, updated);
        return updated;
      }
      const lane: RoadmapLane = {
        id: nextId("lane"),
        boardId: input.boardId,
        name: input.name,
        states: [...input.states],
        order: input.order,
      };
      lanes.set(lane.id, lane);
      return lane;
    },
    async listLanes(input: {
      boardId: string;
    }): Promise<readonly RoadmapLane[]> {
      return [...lanes.values()]
        .filter((lane) => lane.boardId === input.boardId)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    },
  };
}

describe("conformance suite", () => {
  it("passes against the in-memory adapter", async () => {
    await runConformanceSuite(createMemoryRepository());
  });
});
