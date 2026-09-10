import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import { publicBoard, visibility } from "./model.js";
import schema from "./schema.js";

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    visibility: v.optional(visibility),
    allowedKinds: v.optional(v.array(v.string())),
    statusOrder: v.optional(v.array(v.string())),
  },
  returns: v.id("boards"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("boards")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) throw new Error(`Board slug "${args.slug}" is taken.`);
    return await ctx.db.insert("boards", {
      slug: args.slug,
      name: args.name,
      visibility: args.visibility ?? "public",
      allowedKinds: args.allowedKinds ?? ["idea", "bug", "feedback"],
      statusOrder: args.statusOrder ?? [
        "inbox",
        "open",
        "planned",
        "in_progress",
        "shipped",
        "closed",
      ],
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { boardId: v.id("boards") },
  returns: v.union(publicBoard, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.boardId);
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publicBoard, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("boards")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(publicBoard),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await paginator(ctx.db, schema)
      .query("boards")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
