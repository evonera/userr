import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

/** Reject writes from actors the board blocked. Moderators act through
 *  `asModerator`-style host flags, never through this gate. */
export async function requireUnblocked(
  ctx: MutationCtx,
  boardId: Id<"boards">,
  actorId: string,
): Promise<void> {
  const blocked = await ctx.db
    .query("blockedActors")
    .withIndex("by_board_actor", (q) =>
      q.eq("boardId", boardId).eq("actorId", actorId),
    )
    .unique();
  if (blocked) throw new Error("Permission denied: actor is blocked on this board.");
}

export const report = mutation({
  args: {
    itemId: v.id("items"),
    actorId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Feedback item not found.");
    const now = Date.now();
    await ctx.db.patch(args.itemId, { moderation: "pending", updatedAt: now });
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: "flagged",
      actorId: args.actorId,
      payload: args.reason ? { reason: args.reason } : {},
      createdAt: now,
    });
    return null;
  },
});

export const review = mutation({
  args: {
    itemId: v.id("items"),
    decision: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("spam"),
    ),
    actorId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Feedback item not found.");
    const now = Date.now();
    await ctx.db.patch(args.itemId, {
      moderation: args.decision,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: "moderated",
      actorId: args.actorId,
      payload: { from: item.moderation, to: args.decision },
      createdAt: now,
    });
    return null;
  },
});

export const block = mutation({
  args: {
    boardId: v.id("boards"),
    actorId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("blockedActors")
      .withIndex("by_board_actor", (q) =>
        q.eq("boardId", args.boardId).eq("actorId", args.actorId),
      )
      .unique();
    if (existing) return null;
    await ctx.db.insert("blockedActors", {
      boardId: args.boardId,
      actorId: args.actorId,
      reason: args.reason,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const unblock = mutation({
  args: { boardId: v.id("boards"), actorId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("blockedActors")
      .withIndex("by_board_actor", (q) =>
        q.eq("boardId", args.boardId).eq("actorId", args.actorId),
      )
      .unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const isBlocked = query({
  args: { boardId: v.id("boards"), actorId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const blocked = await ctx.db
      .query("blockedActors")
      .withIndex("by_board_actor", (q) =>
        q.eq("boardId", args.boardId).eq("actorId", args.actorId),
      )
      .unique();
    return blocked !== null;
  },
});
