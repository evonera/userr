import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import { normalizeTitle, publicChangelogEntry } from "./model.js";
import schema from "./schema.js";

export const publish = mutation({
  args: {
    boardId: v.id("boards"),
    title: v.string(),
    body: v.string(),
    version: v.optional(v.string()),
    linkedItemIds: v.optional(v.array(v.id("items"))),
    publishedAt: v.optional(v.number()),
  },
  returns: v.id("changelogEntries"),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new Error("Board not found.");
    const title = args.title.trim();
    if (title.length === 0) throw new Error("Title is required.");
    // Linked items must exist on this board: no dangling or cross-board refs.
    for (const itemId of args.linkedItemIds ?? []) {
      const item = await ctx.db.get(itemId);
      if (!item || item.boardId !== args.boardId) {
        throw new Error("Linked items must exist on this board.");
      }
    }
    const now = Date.now();
    const slugBase =
      normalizeTitle(title).replace(/ /g, "-").slice(0, 72) || "update";
    const id = await ctx.db.insert("changelogEntries", {
      boardId: args.boardId,
      title,
      slug: "pending",
      body: args.body,
      version: args.version,
      linkedItemIds: args.linkedItemIds ?? [],
      publishedAt: args.publishedAt,
      createdAt: now,
    });
    await ctx.db.patch(id, {
      slug: `${slugBase}-${id.slice(-8).toLowerCase()}`,
    });
    return id;
  },
});

export const list = query({
  args: { boardId: v.id("boards"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(publicChangelogEntry),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await paginator(ctx.db, schema)
      .query("changelogEntries")
      .withIndex("by_board_created", (q) => q.eq("boardId", args.boardId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getBySlug = query({
  args: { boardId: v.id("boards"), slug: v.string() },
  returns: v.union(publicChangelogEntry, v.null()),
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("changelogEntries")
      .withIndex("by_board_created", (q) => q.eq("boardId", args.boardId))
      .collect();
    return entries.find((entry) => entry.slug === args.slug) ?? null;
  },
});
