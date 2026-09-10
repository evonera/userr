import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";
import { publicSubscription } from "./model.js";

export const subscribe = mutation({
  args: {
    itemId: v.id("items"),
    actorId: v.string(),
    notifyComments: v.optional(v.boolean()),
    notifyStatusChanges: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.mergedInto) {
      throw new Error("Feedback item is unavailable.");
    }
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_item_actor", (q) =>
        q.eq("itemId", args.itemId).eq("actorId", args.actorId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        notifyComments: args.notifyComments ?? existing.notifyComments ?? true,
        notifyStatusChanges:
          args.notifyStatusChanges ?? existing.notifyStatusChanges ?? true,
      });
      return null;
    }
    await ctx.db.insert("subscriptions", {
      itemId: args.itemId,
      actorId: args.actorId,
      notifyComments: args.notifyComments ?? true,
      notifyStatusChanges: args.notifyStatusChanges ?? true,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const unsubscribe = mutation({
  args: { itemId: v.id("items"), actorId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_item_actor", (q) =>
        q.eq("itemId", args.itemId).eq("actorId", args.actorId),
      )
      .unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

/** Actor IDs subscribed to an item. The host fans notifications out through
 *  its own email provider; the component never sends mail itself. */
export const subscribers = query({
  args: { itemId: v.id("items") },
  returns: v.array(publicSubscription),
  handler: async (ctx, args) => {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_item_actor", (q) => q.eq("itemId", args.itemId))
      .collect();
    return subs.map((sub) => ({
      ...sub,
      notifyComments: sub.notifyComments ?? true,
      notifyStatusChanges: sub.notifyStatusChanges ?? true,
    }));
  },
});
