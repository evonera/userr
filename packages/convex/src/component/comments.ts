import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import { enqueueEvent } from "./webhooks.js";
import { requireUnblocked } from "./moderation.js";
import type { MutationCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_DEPTH,
  pageOfComments,
  publicComment,
} from "./model.js";
import schema from "./schema.js";

function checkBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("Comment body is required.");
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be at most ${MAX_COMMENT_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/** Walk the parent chain to enforce a maximum reply depth. */
async function depthOf(
  ctx: MutationCtx,
  parentId: Id<"comments"> | undefined,
): Promise<number> {
  let depth = 0;
  let current = parentId;
  while (current) {
    depth += 1;
    if (depth > MAX_COMMENT_DEPTH) break;
    const parent = await ctx.db.get(current);
    if (!parent) throw new Error("Parent comment not found.");
    current = parent.parentId;
  }
  return depth;
}

function toPublicComment(doc: Doc<"comments">) {
  // Strip internal bookkeeping so the result matches the public validator
  // exactly; deleted comments surface as tombstones (body: null).
  const { body: _body, deletedAt: _deletedAt, ...rest } = doc;
  void _body;
  void _deletedAt;
  return { ...rest, body: doc.deletedAt ? null : doc.body };
}

export const list = query({
  args: { itemId: v.id("items"), paginationOpts: paginationOptsValidator },
  returns: pageOfComments,
  handler: async (ctx, args) => {
    const result = await paginator(ctx.db, schema)
      .query("comments")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .order("asc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(toPublicComment) };
  },
});

export const create = mutation({
  args: {
    itemId: v.id("items"),
    actorId: v.string(),
    body: v.string(),
    parentId: v.optional(v.id("comments")),
  },
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.mergedInto) {
      throw new Error("Feedback item is unavailable.");
    }
    await requireUnblocked(ctx, item.boardId, args.actorId);
    const body = checkBody(args.body);
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.itemId !== args.itemId || parent.deletedAt) {
        throw new Error("Parent comment is unavailable.");
      }
      const depth = await depthOf(ctx, args.parentId);
      if (depth >= MAX_COMMENT_DEPTH) {
        throw new Error(
          `Replies are limited to ${MAX_COMMENT_DEPTH} levels.`,
        );
      }
    }
    const now = Date.now();
    const id = await ctx.db.insert("comments", {
      itemId: args.itemId,
      actorId: args.actorId,
      body,
      parentId: args.parentId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.itemId, {
      commentCount: item.commentCount + 1,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      itemId: args.itemId,
      type: "commented",
      actorId: args.actorId,
      payload: { commentId: id },
      createdAt: now,
    });
    await enqueueEvent(ctx, item.boardId, "comment.created", {
      itemId: args.itemId,
      commentId: id,
    });
    return id;
  },
});

export const edit = mutation({
  args: {
    commentId: v.id("comments"),
    actorId: v.string(),
    body: v.string(),
    /** Set by the host wrapper after it verifies moderator rights. */
    asModerator: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.deletedAt) {
      throw new Error("Comment is unavailable.");
    }
    if (comment.actorId !== args.actorId && !args.asModerator) {
      throw new Error("Only the author can edit this comment.");
    }
    await ctx.db.patch(args.commentId, {
      body: checkBody(args.body),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: {
    commentId: v.id("comments"),
    actorId: v.string(),
    /** Set by the host wrapper after it verifies moderator rights. */
    asModerator: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.deletedAt) {
      throw new Error("Comment is unavailable.");
    }
    if (comment.actorId !== args.actorId && !args.asModerator) {
      throw new Error("Only the author can delete this comment.");
    }
    const now = Date.now();
    await ctx.db.patch(args.commentId, { deletedAt: now, updatedAt: now });
    const item = await ctx.db.get(comment.itemId);
    if (item) {
      await ctx.db.patch(comment.itemId, {
        commentCount: Math.max(0, item.commentCount - 1),
        updatedAt: now,
      });
    }
    return null;
  },
});

export const get = query({
  args: { commentId: v.id("comments") },
  returns: v.union(publicComment, v.null()),
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    return comment ? toPublicComment(comment) : null;
  },
});
