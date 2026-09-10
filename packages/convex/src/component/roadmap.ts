import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import { itemState, publicLane } from "./model.js";

/**
 * Roadmap lanes group item states into public columns ("Now" → in_progress,
 * "Next" → planned). The board view itself is derived: items are queried per
 * state, so no denormalized roadmap table can drift.
 */
export const save = mutation({
  args: {
    id: v.optional(v.id("roadmapLanes")),
    boardId: v.id("boards"),
    name: v.string(),
    states: v.array(itemState),
    order: v.number(),
  },
  returns: v.id("roadmapLanes"),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) throw new Error("Lane name is required.");
    if (args.id) {
      const lane = await ctx.db.get(args.id);
      if (!lane || lane.boardId !== args.boardId) {
        throw new Error("Roadmap lane not found.");
      }
      await ctx.db.patch(args.id, {
        name,
        states: args.states,
        order: args.order,
      });
      return args.id;
    }
    return await ctx.db.insert("roadmapLanes", {
      boardId: args.boardId,
      name,
      states: args.states,
      order: args.order,
    });
  },
});

export const list = query({
  args: { boardId: v.id("boards") },
  returns: v.array(publicLane),
  handler: async (ctx, args) => {
    const lanes = await ctx.db
      .query("roadmapLanes")
      .withIndex("by_board_order", (q) => q.eq("boardId", args.boardId))
      .collect();
    return lanes.sort((a, b) => a.order - b.order);
  },
});
