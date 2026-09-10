import { v } from "convex/values";

export const normalizeTitle = (title: string) =>
  title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");

export function itemPublicId(id: string): string {
  return id.slice(-8).toUpperCase();
}

export const itemState = v.union(
  v.literal("inbox"),
  v.literal("open"),
  v.literal("planned"),
  v.literal("in_progress"),
  v.literal("shipped"),
  v.literal("closed"),
  v.literal("merged"),
);

export const moderationState = v.union(
  v.literal("approved"),
  v.literal("pending"),
  v.literal("rejected"),
  v.literal("spam"),
);

export const visibility = v.union(v.literal("public"), v.literal("private"));

export const publicBoard = v.object({
  _id: v.id("boards"),
  _creationTime: v.number(),
  slug: v.string(),
  name: v.string(),
  visibility,
  allowedKinds: v.array(v.string()),
  statusOrder: v.array(v.string()),
  createdAt: v.number(),
});

export const publicItem = v.object({
  _id: v.id("items"),
  _creationTime: v.number(),
  boardId: v.id("boards"),
  publicId: v.string(),
  slug: v.string(),
  title: v.string(),
  body: v.string(),
  normalizedTitle: v.string(),
  searchText: v.string(),
  kind: v.string(),
  state: itemState,
  authorId: v.string(),
  voteCount: v.number(),
  commentCount: v.number(),
  labels: v.array(v.string()),
  mergedInto: v.optional(v.id("items")),
  moderation: v.optional(moderationState),
  context: v.optional(v.any()),
  embeddingState: v.union(
    v.literal("pending"),
    v.literal("ready"),
    v.literal("disabled"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const publicComment = v.object({
  _id: v.id("comments"),
  _creationTime: v.number(),
  itemId: v.id("items"),
  actorId: v.string(),
  /** Null when the comment was soft-deleted; replies keep their shape. */
  body: v.union(v.string(), v.null()),
  parentId: v.optional(v.id("comments")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const publicSubscription = v.object({
  _id: v.id("subscriptions"),
  _creationTime: v.number(),
  itemId: v.id("items"),
  actorId: v.string(),
  notifyComments: v.boolean(),
  notifyStatusChanges: v.boolean(),
  createdAt: v.number(),
});

export const publicEvent = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  itemId: v.id("items"),
  type: v.string(),
  actorId: v.optional(v.string()),
  payload: v.any(),
  createdAt: v.number(),
});

export const pageOfItems = v.object({
  page: v.array(publicItem),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
});

export const pageOfComments = v.object({
  page: v.array(publicComment),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
});

export const publicChangelogEntry = v.object({
  _id: v.id("changelogEntries"),
  _creationTime: v.number(),
  boardId: v.id("boards"),
  title: v.string(),
  slug: v.string(),
  body: v.string(),
  version: v.optional(v.string()),
  linkedItemIds: v.array(v.id("items")),
  publishedAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const publicLane = v.object({
  _id: v.id("roadmapLanes"),
  _creationTime: v.number(),
  boardId: v.id("boards"),
  name: v.string(),
  states: v.array(v.string()),
  order: v.number(),
});

export const MAX_COMMENT_DEPTH = 5;
export const MAX_TITLE_LENGTH = 160;
export const MAX_BODY_LENGTH = 10_000;
export const MAX_COMMENT_LENGTH = 5_000;

/**
 * Strip the raw embedding vector before returning items to callers. Vectors
 * are large, opaque, and only meaningful to `findSimilarVector`; every other
 * view serves the public shape. (Object validators reject unexpected fields,
 * so this is load-bearing, not cosmetic.)
 *
 * Missing moderation (pre-moderation documents) falls back to "approved" so
 * old deployments keep reading after upgrade with no backfill step.
 */
export function toPublicItem<T extends { embedding?: number[]; moderation?: string }>(
  doc: T,
): Omit<T, "embedding"> & { moderation: string } {
  const { embedding: _embedding, ...rest } = doc;
  void _embedding;
  return { ...rest, moderation: doc.moderation ?? "approved" };
}
