import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { runConformanceSuite } from "./conformance.js";
import { ITEM_STATES } from "./rules.js";
import {
  assertSafeWebhookUrl,
  generateWebhookSecret,
  nextRetryAt,
  secretPreview,
  VOTE_MILESTONES,
} from "./webhooks.js";
import type {
  Board,
  BoardInput,
  ChangelogEntry,
  ChangelogInput,
  CursorPage,
  Delivery,
  FeedbackEvent,
  FeedbackItem,
  FeedbackRepository,
  ItemInput,
  ItemState,
  LaneInput,
  MergePlan,
  ModerationState,
  RoadmapLane,
  Webhook,
  WebhookEventType,
  WebhookInput,
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
  const webhooks = new Map<string, Webhook & { secret: string }>();
  const deliveries = new Map<
    string,
    Delivery & { leaseOwner?: string; leaseExpiresAt?: number }
  >();
  const blocked = new Map<string, Set<string>>();
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  function isBlocked(boardId: string, actorId: string): boolean {
    return blocked.get(boardId)?.has(actorId) ?? false;
  }

  function requireUnblocked(boardId: string, actorId: string): void {
    if (isBlocked(boardId, actorId)) {
      throw new Error("Permission denied: actor is blocked on this board.");
    }
  }

  function webhooksFor(boardId: string, type: Delivery["event"]) {
    return [...webhooks.values()].filter(
      (hook) => hook.boardId === boardId && hook.active && hook.events.includes(type),
    );
  }

  function enqueue(
    boardId: string,
    type: Delivery["event"],
    payload: Record<string, unknown>,
  ) {
    for (const hook of webhooksFor(boardId, type)) {
      const id = nextId("dlv");
      deliveries.set(id, {
        id,
        webhookId: hook.id,
        event: type,
        payload,
        status: "pending",
        attempts: 0,
      });
      hook.lastTriggeredAt = Date.now();
    }
  }

  return {
    async createBoard(input: BoardInput): Promise<Board> {
      const board: Board = { id: nextId("board"), ...input };
      boards.set(board.id, board);
      return board;
    },
    async createItem(input: ItemInput): Promise<FeedbackItem> {
      const now = Date.now();
      const id = nextId("item");
      requireUnblocked(input.boardId, input.authorId);
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
        moderation: "approved",
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
      enqueue(input.boardId, "post.created", { itemId: id });
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
      moderation?: ModerationState;
      includeModerated?: boolean;
    }): Promise<CursorPage<FeedbackItem>> {
      const all = [...items.values()]
        .filter((item) => item.boardId === input.boardId)
        .filter((item) => !input.state || item.state === input.state)
        .filter((item) =>
          input.moderation
            ? item.moderation === input.moderation
            : input.includeModerated || item.moderation === "approved",
        )
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
      requireUnblocked(item.boardId, input.actorId);
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
      if (VOTE_MILESTONES.includes(item.voteCount)) {
        enqueue(item.boardId, "vote.milestone", {
          itemId: item.id,
          voteCount: item.voteCount,
        });
      }
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
      enqueue(item.boardId, "post.status_changed", {
        itemId: item.id,
        from,
        to: input.state,
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
      enqueue(source.boardId, "post.merged", {
        sourceId: plan.sourceId,
        targetId: plan.targetId,
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
      for (const itemId of input.linkedItemIds) {
        const item = items.get(itemId);
        if (!item || item.boardId !== input.boardId) {
          throw new Error("Linked items must exist on this board.");
        }
      }
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
      enqueue(input.boardId, "changelog.published", { entryId: id });
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
      for (const state of input.states) {
        if (!ITEM_STATES.includes(state)) {
          throw new Error(`Invalid lane state "${state}".`);
        }
      }
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
    async createWebhook(input: WebhookInput) {
      assertSafeWebhookUrl(input.url);
      const secret = generateWebhookSecret();
      const hook: Webhook & { secret: string } = {
        id: nextId("hook"),
        boardId: input.boardId,
        url: input.url,
        secretPreview: secretPreview(secret),
        events: [...input.events],
        active: true,
        failureCount: 0,
        secret,
      };
      webhooks.set(hook.id, hook);
      const { secret: _, ...webhook } = hook;
      void _;
      return { webhook, secret };
    },
    async listWebhooks(input: { boardId: string }) {
      return [...webhooks.values()]
        .filter((hook) => hook.boardId === input.boardId)
        .map(({ secret: _, ...webhook }) => {
          void _;
          return webhook;
        });
    },
    async getWebhook(input: { id: string }) {
      const hook = webhooks.get(input.id);
      if (!hook) return null;
      const { secret: _, ...webhook } = hook;
      void _;
      return webhook;
    },
    async updateWebhook(input: {
      id: string;
      url?: string;
      events?: readonly WebhookEventType[];
      active?: boolean;
    }): Promise<void> {
      const hook = webhooks.get(input.id);
      assert.ok(hook, "webhook must exist to update");
      if (input.url !== undefined) {
        assertSafeWebhookUrl(input.url);
        hook.url = input.url;
      }
      if (input.events !== undefined) hook.events = [...input.events];
      if (input.active !== undefined) hook.active = input.active;
    },
    async rotateWebhookSecret(input: { id: string }) {
      const hook = webhooks.get(input.id);
      assert.ok(hook, "webhook must exist to rotate");
      const secret = generateWebhookSecret();
      hook.secret = secret;
      hook.secretPreview = secretPreview(secret);
      hook.failureCount = 0;
      return { secret };
    },
    async deleteWebhook(input: { id: string }): Promise<void> {
      assert.ok(webhooks.delete(input.id), "webhook must exist to delete");
      for (const [id, delivery] of deliveries) {
        if (delivery.webhookId === input.id) deliveries.delete(id);
      }
    },
    async listDeliveries(input: {
      webhookId?: string;
      status?: Delivery["status"];
      limit?: number;
    }) {
      return [...deliveries.values()]
        .filter((d) => !input.webhookId || d.webhookId === input.webhookId)
        .filter((d) => !input.status || d.status === input.status)
        .slice(0, input.limit ?? 50);
    },
    async recordDeliveryOutcome(input: {
      deliveryId: string;
      ok: boolean;
      error?: string;
      at?: number;
      leaseOwner?: string;
    }) {
      const delivery = deliveries.get(input.deliveryId);
      assert.ok(delivery, "delivery must exist");
      const now = input.at ?? Date.now();
      const hook = webhooks.get(delivery.webhookId);
      if (
        delivery.leaseOwner &&
        (delivery.leaseExpiresAt ?? 0) > now &&
        input.leaseOwner !== delivery.leaseOwner
      ) {
        throw new Error("Delivery lease held by another worker.");
      }
      delivery.attempts += 1;
      if (input.ok) {
        delivery.status = "delivered";
        delivery.deliveredAt = now;
        delivery.lastError = undefined;
        if (hook) {
          hook.failureCount = 0;
          hook.lastTriggeredAt = now;
        }
        return { ...delivery };
      }
      delivery.lastError = input.error ?? "delivery failed";
      const retryAt = nextRetryAt(delivery.attempts, now);
      if (retryAt === null) {
        delivery.status = "failed";
        delivery.nextRetryAt = undefined;
        if (hook) {
          hook.failureCount += 1;
          hook.active = false;
          hook.lastError = delivery.lastError;
        }
      } else {
        delivery.status = "pending";
        delivery.nextRetryAt = retryAt;
        if (hook) {
          hook.failureCount += 1;
          hook.lastError = delivery.lastError;
        }
      }
      return { ...delivery };
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
      if (input.itemIds.length > 50) {
        throw new Error("Bulk updates are limited to 50 items.");
      }
      const targets = input.itemIds.map((id) => {
        const item = items.get(id);
        if (!item || item.mergedInto) {
          throw new Error(`Item ${id} is unavailable for bulk update.`);
        }
        return item;
      });
      const now = Date.now();
      for (const item of targets) {
        if (item.state === input.state) continue;
        const from = item.state;
        item.state = input.state;
        item.updatedAt = now;
        events.push({
          id: nextId("evt"),
          itemId: item.id,
          type: "state_changed",
          actorId: input.actorId,
          createdAt: now,
          payload: { from, to: input.state },
        });
      }
      return { updated: targets.length };
    },
    async reportItem(input: {
      itemId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      const item = items.get(input.itemId);
      assert.ok(item, "item must exist to report");
      item.moderation = "pending";
      item.updatedAt = Date.now();
      events.push({
        id: nextId("evt"),
        itemId: input.itemId,
        type: "flagged",
        actorId: input.actorId,
        createdAt: Date.now(),
        payload: input.reason ? { reason: input.reason } : {},
      });
    },
    async reviewItem(input: {
      itemId: string;
      decision: Exclude<ModerationState, "pending">;
      actorId: string;
    }): Promise<void> {
      const item = items.get(input.itemId);
      assert.ok(item, "item must exist to review");
      const from = item.moderation;
      item.moderation = input.decision;
      item.updatedAt = Date.now();
      events.push({
        id: nextId("evt"),
        itemId: input.itemId,
        type: "moderated",
        actorId: input.actorId,
        createdAt: Date.now(),
        payload: { from, to: input.decision },
      });
    },
    async blockActor(input: {
      boardId: string;
      actorId: string;
      reason?: string;
    }): Promise<void> {
      let set = blocked.get(input.boardId);
      if (!set) {
        set = new Set();
        blocked.set(input.boardId, set);
      }
      set.add(input.actorId);
      void input.reason;
    },
    async unblockActor(input: {
      boardId: string;
      actorId: string;
    }): Promise<void> {
      blocked.get(input.boardId)?.delete(input.actorId);
    },
    async isBlocked(input: {
      boardId: string;
      actorId: string;
    }): Promise<boolean> {
      return isBlocked(input.boardId, input.actorId);
    },
  };
}

describe("conformance suite", () => {
  it("passes against the in-memory adapter", async () => {
    await runConformanceSuite(createMemoryRepository());
  });
});
