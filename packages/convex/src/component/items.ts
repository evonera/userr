import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { itemPublicId, normalizeTitle } from "./model.js";

const state = v.union(v.literal("inbox"), v.literal("open"), v.literal("planned"), v.literal("in_progress"), v.literal("shipped"), v.literal("closed"), v.literal("merged"));

export const list = query({
  args: { boardId: v.id("boards"), state: v.optional(state) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const items = args.state
      ? await ctx.db.query("items").withIndex("by_board_state", (q) => q.eq("boardId", args.boardId).eq("state", args.state!)).collect()
      : await ctx.db.query("items").filter((q) => q.eq(q.field("boardId"), args.boardId)).collect();
    return items.filter((item) => !item.mergedInto).sort((a, b) => b.voteCount - a.voteCount || b.createdAt - a.createdAt);
  },
});

export const create = mutation({
  args: { boardId: v.id("boards"), actorId: v.string(), title: v.string(), body: v.string(), kind: v.string(), context: v.optional(v.any()) },
  returns: v.id("items"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("items", {
      boardId: args.boardId, publicId: "pending", slug: "pending", title: args.title.trim(), body: args.body.trim(),
      normalizedTitle: normalizeTitle(args.title), searchText: `${args.title}\n${args.body}`, kind: args.kind,
      state: "inbox", authorId: args.actorId, voteCount: 0, commentCount: 0, labels: [], context: args.context,
      embeddingState: "pending", createdAt: now, updatedAt: now,
    });
    const publicId = itemPublicId(id);
    await ctx.db.patch(id, { publicId, slug: `${normalizeTitle(args.title).replace(/ /g, "-").slice(0, 72)}-${publicId.toLowerCase()}` });
    await ctx.db.insert("events", { itemId: id, type: "created", actorId: args.actorId, payload: {}, createdAt: now });
    return id;
  },
});

export const vote = mutation({
  args: { itemId: v.id("items"), actorId: v.string() },
  returns: v.object({ added: v.boolean(), voteCount: v.number() }),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.mergedInto) throw new Error("Feedback item is unavailable.");
    const prior = await ctx.db.query("votes").withIndex("by_item_actor", (q) => q.eq("itemId", args.itemId).eq("actorId", args.actorId)).unique();
    if (prior) return { added: false, voteCount: item.voteCount };
    const now = Date.now();
    await ctx.db.insert("votes", { itemId: args.itemId, actorId: args.actorId, createdAt: now });
    await ctx.db.patch(args.itemId, { voteCount: item.voteCount + 1, updatedAt: now });
    await ctx.db.insert("events", { itemId: args.itemId, type: "vote_added", actorId: args.actorId, payload: {}, createdAt: now });
    return { added: true, voteCount: item.voteCount + 1 };
  },
});

export const merge = mutation({
  args: { sourceId: v.id("items"), targetId: v.id("items"), actorId: v.string(), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.sourceId === args.targetId) throw new Error("Cannot merge an item into itself.");
    const [source, target] = await Promise.all([ctx.db.get(args.sourceId), ctx.db.get(args.targetId)]);
    if (!source || !target || source.boardId !== target.boardId || source.mergedInto || target.mergedInto) throw new Error("Invalid merge target.");
    const now = Date.now();
    const votes = await ctx.db.query("votes").withIndex("by_item_actor", (q) => q.eq("itemId", args.sourceId)).collect();
    let transferred = 0;
    for (const vote of votes) {
      const existing = await ctx.db.query("votes").withIndex("by_item_actor", (q) => q.eq("itemId", args.targetId).eq("actorId", vote.actorId)).unique();
      if (!existing) { await ctx.db.insert("votes", { itemId: args.targetId, actorId: vote.actorId, createdAt: now }); transferred += 1; }
    }
    await ctx.db.patch(args.targetId, { voteCount: target.voteCount + transferred, updatedAt: now });
    await ctx.db.patch(args.sourceId, { state: "merged", mergedInto: args.targetId, updatedAt: now });
    await ctx.db.insert("events", { itemId: args.sourceId, type: "merged", actorId: args.actorId, payload: { targetId: args.targetId, reason: args.reason }, createdAt: now });
    return null;
  },
});
