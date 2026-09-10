import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * pgvector column. Drizzle has no native vector type, so this maps number[]
 * to the `vector(N)` text wire format (`[1,2,3]`) accepted by both Neon and
 * PGlite's vector extension. Reads parse defensively: pgvector returns text,
 * some drivers return arrays.
 */
export function vector(name: string, dimensions: number) {
  return customType<{ data: number[] }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value) => `[${value.join(",")}]`,
    fromDriver: (value: unknown): number[] => {
      if (Array.isArray(value)) return value as number[];
      if (typeof value === "string") return JSON.parse(value) as number[];
      throw new Error(`Cannot parse vector column ${name}`);
    },
  })(name);
}

const EMBEDDING_DIMENSIONS = 1536;

export const boards = pgTable(
  "boards",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    visibility: text("visibility").notNull().default("public"),
    allowedKinds: jsonb("allowed_kinds").$type<string[]>().notNull(),
    statusOrder: jsonb("status_order").$type<string[]>().notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("boards_slug_idx").on(table.slug)],
);

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    publicId: text("public_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    normalizedTitle: text("normalized_title").notNull(),
    searchText: text("search_text").notNull().default(""),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("inbox"),
    authorId: text("author_id").notNull(),
    voteCount: integer("vote_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    mergedInto: text("merged_into"),
    moderation: text("moderation").notNull().default("approved"),
    context: jsonb("context").$type<
      Record<string, string | number | boolean | null>
    >(),
    embedding: vector("embedding", EMBEDDING_DIMENSIONS),
    embeddingState: text("embedding_state").notNull().default("pending"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("items_board_state_idx").on(table.boardId, table.state),
    index("items_board_title_idx").on(table.boardId, table.normalizedTitle),
    index("items_merged_into_idx").on(table.mergedInto),
  ],
);

export const blockedActors = pgTable(
  "blocked_actors",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    actorId: text("actor_id").notNull(),
    reason: text("reason"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.actorId] })],
);

export const votes = pgTable(  "votes",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.actorId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    body: text("body").notNull(),
    parentId: text("parent_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deletedAt: bigint("deleted_at", { mode: "number" }),
  },
  (table) => [index("comments_item_idx").on(table.itemId)],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("events_item_created_idx").on(table.itemId, table.createdAt)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    notifyComments: boolean("notify_comments").notNull().default(true),
    notifyStatusChanges: boolean("notify_status_changes")
      .notNull()
      .default(true),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.actorId] })],
);

export const changelogEntries = pgTable(
  "changelog_entries",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    body: text("body").notNull().default(""),
    version: text("version"),
    linkedItemIds: jsonb("linked_item_ids").$type<string[]>().notNull(),
    publishedAt: bigint("published_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("changelog_board_created_idx").on(table.boardId, table.createdAt)],
);

export const roadmapLanes = pgTable(
  "roadmap_lanes",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    name: text("name").notNull(),
    states: jsonb("states").$type<string[]>().notNull(),
    order: integer("sort_order").notNull().default(0),
  },
  (table) => [index("lanes_board_order_idx").on(table.boardId, table.order)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    active: boolean("active").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    lastTriggeredAt: bigint("last_triggered_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("webhooks_board_idx").on(table.boardId)],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: bigint("next_retry_at", { mode: "number" }),
    lastError: text("last_error"),
    deliveredAt: bigint("delivered_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deliveries_webhook_idx").on(table.webhookId),
    index("deliveries_status_retry_idx").on(table.status, table.nextRetryAt),
  ],
);

export type Schema = {
  boards: typeof boards;
  items: typeof items;
  votes: typeof votes;
  comments: typeof comments;
  events: typeof events;
  subscriptions: typeof subscriptions;
  changelogEntries: typeof changelogEntries;
  roadmapLanes: typeof roadmapLanes;
  webhooks: typeof webhooks;
  deliveries: typeof deliveries;
  blockedActors: typeof blockedActors;
};
