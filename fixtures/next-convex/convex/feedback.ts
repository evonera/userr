import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  requireActor,
  requireModerator,
  type FeedbackHostConfig,
} from "@userr/convex/client";

// Canonical host wrapper: resolve identity with the host's own auth (Convex
// Auth, Better Auth, Clerk, or custom JWT — they all reduce to an actor ID
// plus a role), enforce moderation, then delegate to the isolated component.
export const config: FeedbackHostConfig = {
  resolveActorId: async () => {
    // Wire real auth here, e.g. `await getAuthUserId(ctx)`.
    return null;
  },
  resolveRole: async () => "member",
  transitions: [
    { from: "inbox", to: "open", roles: ["moderator", "admin", "owner"] },
    { from: "open", to: "planned", roles: ["moderator", "admin", "owner"] },
    { from: "planned", to: "in_progress", roles: ["moderator", "admin", "owner"] },
    { from: "in_progress", to: "shipped", roles: ["moderator", "admin", "owner"] },
    { from: "open", to: "closed", roles: ["moderator", "admin", "owner"] },
  ],
};

export const listItems = query({
  args: {
    boardId: v.string(),
    paginationOpts: v.any(),
  },
  handler: async (ctx, args) => {
    // Public listing: no actor required. Pass an allowlist through for
    // private boards in a real app.
    return await ctx.runQuery(components.userr.items.list, {
      boardId: args.boardId as never,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const createItem = mutation({
  args: {
    boardId: v.string(),
    title: v.string(),
    body: v.string(),
    kind: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = requireActor(await config.resolveActorId());
    return await ctx.runMutation(components.userr.items.create, {
      boardId: args.boardId as never,
      actorId: actor,
      title: args.title,
      body: args.body,
      kind: args.kind,
    });
  },
});

export const setItemState = mutation({
  args: {
    boardId: v.string(),
    itemId: v.string(),
    state: v.union(
      v.literal("open"),
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("shipped"),
      v.literal("closed"),
    ),
  },
  handler: async (ctx, args) => {
    const moderator = await requireModerator(config, args.boardId);
    return await ctx.runMutation(components.userr.items.setState, {
      itemId: args.itemId as never,
      state: args.state as never,
      actorId: moderator,
    });
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const boardId: string = await ctx.runMutation(
      components.userr.boards.create,
      { slug: "feedback", name: "Feedback" },
    );
    const samples = [
      { title: "Dark mode", body: "Please add dark mode.", kind: "idea" },
      { title: "CSV export", body: "Export boards to CSV.", kind: "idea" },
      { title: "Crash on login", body: "App crashes on SSO login.", kind: "bug" },
    ];
    for (const sample of samples) {
      await ctx.runMutation(components.userr.items.create, {
        boardId: boardId as never,
        actorId: "seed",
        ...sample,
      });
    }
    return boardId;
  },
});
