import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const state = v.union(
  v.literal("inbox"), v.literal("open"), v.literal("planned"),
  v.literal("in_progress"), v.literal("shipped"), v.literal("closed"), v.literal("merged"),
);

export default defineSchema({
  boards: defineTable({
    slug: v.string(), name: v.string(), visibility: v.union(v.literal("public"), v.literal("private")),
    allowedKinds: v.array(v.string()), statusOrder: v.array(v.string()), createdAt: v.number(),
  }).index("by_slug", ["slug"]),
  items: defineTable({
    boardId: v.id("boards"), publicId: v.string(), slug: v.string(), title: v.string(), body: v.string(),
    normalizedTitle: v.string(), searchText: v.string(), kind: v.string(), state, authorId: v.string(),
    voteCount: v.number(), commentCount: v.number(), labels: v.array(v.string()), mergedInto: v.optional(v.id("items")),
    context: v.optional(v.any()), embedding: v.optional(v.array(v.float64())), embeddingState: v.union(v.literal("pending"), v.literal("ready"), v.literal("disabled")),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_board_state", ["boardId", "state"])
    .index("by_board_normalized_title", ["boardId", "normalizedTitle"])
    .index("by_merged_into", ["mergedInto"])
    .searchIndex("search", { searchField: "searchText", filterFields: ["boardId", "state"] })
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["boardId"] }),
  votes: defineTable({ itemId: v.id("items"), actorId: v.string(), createdAt: v.number() }).index("by_item_actor", ["itemId", "actorId"]),
  comments: defineTable({ itemId: v.id("items"), actorId: v.string(), body: v.string(), parentId: v.optional(v.id("comments")), createdAt: v.number(), updatedAt: v.number(), deletedAt: v.optional(v.number()) }).index("by_item", ["itemId"]),
  events: defineTable({ itemId: v.id("items"), type: v.string(), actorId: v.optional(v.string()), payload: v.any(), createdAt: v.number() }).index("by_item_created", ["itemId", "createdAt"]),
  subscriptions: defineTable({ itemId: v.id("items"), actorId: v.string(), notifyComments: v.optional(v.boolean()), notifyStatusChanges: v.optional(v.boolean()), createdAt: v.number() }).index("by_item_actor", ["itemId", "actorId"]),
  changelogEntries: defineTable({
    boardId: v.id("boards"), title: v.string(), slug: v.string(), body: v.string(),
    version: v.optional(v.string()), linkedItemIds: v.array(v.id("items")),
    publishedAt: v.optional(v.number()), createdAt: v.number(),
  }).index("by_board_created", ["boardId", "createdAt"]),
  roadmapLanes: defineTable({
    boardId: v.id("boards"), name: v.string(), states: v.array(v.string()), order: v.number(),
  }).index("by_board_order", ["boardId", "order"]),
});
