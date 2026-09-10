import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  itemPublicId,
  itemState,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeTitle,
  pageOfItems,
  publicItem,
  toPublicItem,
} from "./model.js";
import schema from "./schema.js";

function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error("Title is required.");
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Error(`Title must be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return trimmed;
}

function checkBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new Error(`Body must be at most ${MAX_BODY_LENGTH} characters.`);
  }
  return trimmed;
}

async function requireItem(
  ctx: QueryCtx | MutationCtx,
  itemId: Id<"items">,
): Promise<Doc<"items">> {
  const item = await ctx.db.get(itemId);
  if (!item) throw new Error("Feedback item not found.");
  return item;
}

export const list = query({
  args: {
    boardId: v.id("boards"),
    state: v.optional(itemState),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageOfItems,
  handler: async (ctx, args) => {
    const base = paginator(ctx.db, schema).query("items");
    const scoped = args.state
      ? base.withIndex("by_board_state", (q) =>
          q.eq("boardId", args.boardId).eq("state", args.state!),
        )
      : base.withIndex("by_board_state", (q) =>
          q.eq("boardId", args.boardId),
        );
    // Newest first. Merged items stay in the listing with `state: "merged"`
    // and a `mergedInto` pointer: triage needs them, and public views filter
    // `state !== "merged"` (or query a specific state outright).
    const result = await scoped.order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(toPublicItem) };
  },
});

/**
 * Top-voted listing. Vote counts have no dedicated index, so this collects the
 * board slice and sorts in memory. Bounded by `limit` (default 50, max 200);
 * use `list` with cursor pagination for unbounded traversal.
 */
export const listTop = query({
  args: {
    boardId: v.id("boards"),
    state: v.optional(itemState),
    limit: v.optional(v.number()),
  },
  returns: v.array(publicItem),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const items = await ctx.db
      .query("items")
      .withIndex("by_board_state", (q) =>
        args.state
          ? q.eq("boardId", args.boardId).eq("state", args.state)
          : q.eq("boardId", args.boardId),
      )
      .collect();
    return items
      .filter((item) => !item.mergedInto)
      .sort((a, b) => b.voteCount - a.voteCount || b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(toPublicItem);
  },
});

export const get = query({
  args: { itemId: v.id("items"), viewerActorId: v.optional(v.string()) },
  returns: v.union(
    v.object({
      item: publicItem,
      viewerHasVoted: v.boolean(),
      viewerIsSubscribed: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    let viewerHasVoted = false;
    let viewerIsSubscribed = false;
    if (args.viewerActorId) {
      const vote = await ctx.db
        .query("votes")
        .withIndex("by_item_actor", (q) =>
          q.eq("itemId", args.itemId).eq("actorId", args.viewerActorId!),
        )
        .unique();
      viewerHasVoted = vote !== null;
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_item_actor", (q) =>
          q.eq("itemId", args.itemId).eq("actorId", args.viewerActorId!),
        )
        .unique();
      viewerIsSubscribed = sub !== null;
    }
    return { item: toPublicItem(item), viewerHasVoted, viewerIsSubscribed };
  },
});

export const create = mutation({
  args: {
    boardId: v.id("boards"),
    actorId: v.string(),
    title: v.string(),
    body: v.string(),
    kind: v.string(),
    context: v.optional(v.any()),
  },
  returns: v.id("items"),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new Error("Board not found.");
    if (!board.allowedKinds.includes(args.kind)) {
      throw new Error(`Kind "${args.kind}" is not allowed on this board.`);
    }
    const title = checkTitle(args.title);
    const body = checkBody(args.body);
    const now = Date.now();
    const id = await ctx.db.insert("items", {
      boardId: args.boardId,
      publicId: "pending",
      slug: "pending",
      title,
      body,
      normalizedTitle: normalizeTitle(title),
      searchText: `${title}\n${body}`,
      kind: args.kind,
      state: "inbox",
      authorId: args.actorId,
      voteCount: 0,
      commentCount: 0,
      labels: [],
      context: args.context,
      embeddingState: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const publicId = itemPublicId(id);
    await ctx.db.patch(id, {
      publicId,
      slug: `${normalizeTitle(title).replace(/ /g, "-").slice(0, 72)}-${publicId.toLowerCase()}`,
    });
    await ctx.db.insert("events", {
      itemId: id,
      type: "created",
      actorId: args.actorId,
      payload: {},
      createdAt: now,
    });
    return id;
  },
});

/**
 * Transition an item's state. Role checks belong to the host wrapper, which
 * validates against its configured transitions (see `assertTransition` in
 * `@userr/core`) before calling this mutation.
 */
export const setState = mutation({
  args: { itemId: v.id("items"), state: itemState, actorId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await requireItem(ctx, args.itemId);
    if (item.mergedInto) throw new Error("Merged items cannot change state.");
    if (item.state === args.state) return null;
    const now = Date.now();
    await ctx.db.patch(args.itemId, { state: args.state, updatedAt: now });
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: "state_changed",
      actorId: args.actorId,
      payload: { from: item.state, to: args.state },
      createdAt: now,
    });
    return null;
  },
});

export const vote = mutation({
  args: { itemId: v.id("items"), actorId: v.string() },
  returns: v.object({ added: v.boolean(), voteCount: v.number() }),
  handler: async (ctx, args) => {
    const item = await requireItem(ctx, args.itemId);
    if (item.mergedInto) throw new Error("Feedback item is unavailable.");
    const prior = await ctx.db
      .query("votes")
      .withIndex("by_item_actor", (q) =>
        q.eq("itemId", args.itemId).eq("actorId", args.actorId),
      )
      .unique();
    if (prior) return { added: false, voteCount: item.voteCount };
    const now = Date.now();
    await ctx.db.insert("votes", {
      itemId: args.itemId,
      actorId: args.actorId,
      createdAt: now,
    });
    await ctx.db.patch(args.itemId, {
      voteCount: item.voteCount + 1,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: "vote_added",
      actorId: args.actorId,
      payload: {},
      createdAt: now,
    });
    return { added: true, voteCount: item.voteCount + 1 };
  },
});

export const unvote = mutation({
  args: { itemId: v.id("items"), actorId: v.string() },
  returns: v.object({ removed: v.boolean(), voteCount: v.number() }),
  handler: async (ctx, args) => {
    const item = await requireItem(ctx, args.itemId);
    const prior = await ctx.db
      .query("votes")
      .withIndex("by_item_actor", (q) =>
        q.eq("itemId", args.itemId).eq("actorId", args.actorId),
      )
      .unique();
    if (!prior) return { removed: false, voteCount: item.voteCount };
    const now = Date.now();
    await ctx.db.delete(prior._id);
    await ctx.db.patch(args.itemId, {
      voteCount: Math.max(0, item.voteCount - 1),
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: "vote_removed",
      actorId: args.actorId,
      payload: {},
      createdAt: now,
    });
    return { removed: true, voteCount: Math.max(0, item.voteCount - 1) };
  },
});

export const merge = mutation({
  args: {
    sourceId: v.id("items"),
    targetId: v.id("items"),
    actorId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.sourceId === args.targetId) {
      throw new Error("Cannot merge an item into itself.");
    }
    const [source, target] = await Promise.all([
      ctx.db.get(args.sourceId),
      ctx.db.get(args.targetId),
    ]);
    if (
      !source ||
      !target ||
      source.boardId !== target.boardId ||
      source.mergedInto ||
      target.mergedInto
    ) {
      throw new Error("Invalid merge target.");
    }
    const now = Date.now();
    const sourceVotes = await ctx.db
      .query("votes")
      .withIndex("by_item_actor", (q) => q.eq("itemId", args.sourceId))
      .collect();
    let transferred = 0;
    for (const vote of sourceVotes) {
      const existing = await ctx.db
        .query("votes")
        .withIndex("by_item_actor", (q) =>
          q.eq("itemId", args.targetId).eq("actorId", vote.actorId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("votes", {
          itemId: args.targetId,
          actorId: vote.actorId,
          createdAt: now,
        });
        transferred += 1;
      }
    }
    const sourceSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_item_actor", (q) => q.eq("itemId", args.sourceId))
      .collect();
    for (const sub of sourceSubs) {
      const existing = await ctx.db
        .query("subscriptions")
        .withIndex("by_item_actor", (q) =>
          q.eq("itemId", args.targetId).eq("actorId", sub.actorId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("subscriptions", {
          itemId: args.targetId,
          actorId: sub.actorId,
          notifyComments: sub.notifyComments ?? true,
          notifyStatusChanges: sub.notifyStatusChanges ?? true,
          createdAt: now,
        });
      }
    }
    await ctx.db.patch(args.targetId, {
      voteCount: target.voteCount + transferred,
      updatedAt: now,
    });
    await ctx.db.patch(args.sourceId, {
      state: "merged",
      mergedInto: args.targetId,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      itemId: args.sourceId,
      type: "merged",
      actorId: args.actorId,
      payload: { targetId: args.targetId, reason: args.reason },
      createdAt: now,
    });
    return null;
  },
});

/**
 * Lexical duplicate suggestions: exact normalized-title match plus full-text
 * candidates. Served synchronously at creation time — no AI dependency.
 * Vector candidates arrive via `embeddings.findSimilarVector` once the host
 * has run enrichment (see embeddings.ts).
 */
export const findSimilar = query({
  args: {
    boardId: v.id("boards"),
    title: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    exact: v.union(v.id("items"), v.null()),
    similar: v.array(
      v.object({
        id: v.id("items"),
        title: v.string(),
        voteCount: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
    const normalized = normalizeTitle(args.title);
    if (normalized.length === 0) return { exact: null, similar: [] };
    // Normalized titles are deliberately non-unique (creation must never be
    // blocked), so never use .unique() here: two live duplicates would throw.
    // Scan a small bounded set for the first non-merged exact hit instead.
    const exactCandidates = await ctx.db
      .query("items")
      .withIndex("by_board_normalized_title", (q) =>
        q.eq("boardId", args.boardId).eq("normalizedTitle", normalized),
      )
      .take(5);
    const exactHit = exactCandidates.find((item) => !item.mergedInto);
    const exact = exactHit ? exactHit._id : null;
    const candidates = await ctx.db
      .query("items")
      .withSearchIndex("search", (q) =>
        q.search("searchText", args.title).eq("boardId", args.boardId),
      )
      .take(limit * 2);
    const similar: { id: Id<"items">; title: string; voteCount: number }[] = [];
    for (const candidate of candidates) {
      if (candidate.mergedInto) continue;
      if (exact !== null && candidate._id === exact) continue;
      similar.push({
        id: candidate._id,
        title: candidate.title,
        voteCount: candidate.voteCount,
      });
      if (similar.length >= limit) break;
    }
    return { exact, similar };
  },
});

export const events = query({  args: {
    itemId: v.id("items"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("events"),
        _creationTime: v.number(),
        itemId: v.id("items"),
        type: v.string(),
        actorId: v.optional(v.string()),
        payload: v.any(),
        createdAt: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await paginator(ctx.db, schema)
      .query("events")
      .withIndex("by_item_created", (q) => q.eq("itemId", args.itemId))
      .order("asc")
      .paginate(args.paginationOpts);
  },
});

/** Append a host-defined audit event (delivery receipts, moderation notes).
 *  Lifecycle events (created, vote_added, merged, ...) are written by their
 *  own mutations; this covers everything else. */
export const recordEvent = mutation({
  args: {
    itemId: v.id("items"),
    type: v.string(),
    actorId: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await requireItem(ctx, args.itemId);
    if (item.mergedInto) throw new Error("Feedback item is unavailable.");
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: args.type,
      actorId: args.actorId,
      payload: args.payload ?? {},
      createdAt: Date.now(),
    });
    return null;
  },
});
