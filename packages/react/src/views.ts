/**
 * Backend-agnostic view models. Both hook flavors (Convex live queries and
 * REST fetch) normalize into these shapes, so every surface below renders
 * identically regardless of backend.
 */
export interface BoardItemView {
  id: string;
  title: string;
  body: string;
  kind: string;
  state: string;
  voteCount: number;
  commentCount: number;
  labels: readonly string[];
  slug?: string;
}

export interface CommentView {
  id: string;
  itemId: string;
  actorId: string;
  body: string | null;
  parentId?: string;
  createdAt: number;
}

export interface ChangelogEntryView {
  id: string;
  title: string;
  slug: string;
  body: string;
  version?: string;
  publishedAt?: number;
  createdAt: number;
}

export interface RoadmapLaneView {
  id: string;
  name: string;
  states: readonly string[];
  order: number;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function arr(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/** Normalize backend rows (Convex docs, REST JSON, Drizzle rows) into the
 *  view shapes every surface renders. Unknown fields are ignored; missing
 *  scalars fall back to safe defaults. `_id` (Convex) and `id` both map. */
export function toBoardItemView(doc: Record<string, unknown>): BoardItemView {
  return {
    id: str(doc.id ?? doc._id),
    title: str(doc.title),
    body: str(doc.body),
    kind: str(doc.kind, "feedback"),
    state: str(doc.state, "open"),
    voteCount: num(doc.voteCount),
    commentCount: num(doc.commentCount),
    labels: arr(doc.labels),
    slug: typeof doc.slug === "string" ? doc.slug : undefined,
  };
}

export function toCommentView(doc: Record<string, unknown>): CommentView {
  return {
    id: str(doc.id ?? doc._id),
    itemId: str(doc.itemId),
    actorId: str(doc.actorId),
    body:
      doc.body === null || doc.body === undefined
        ? null
        : String(doc.body),
    parentId:
      typeof doc.parentId === "string" ? doc.parentId : undefined,
    createdAt: num(doc.createdAt, Date.now()),
  };
}

export function toChangelogEntryView(
  doc: Record<string, unknown>,
): ChangelogEntryView {
  return {
    id: str(doc.id ?? doc._id),
    title: str(doc.title),
    slug: str(doc.slug),
    body: str(doc.body),
    version: typeof doc.version === "string" ? doc.version : undefined,
    publishedAt:
      typeof doc.publishedAt === "number" ? doc.publishedAt : undefined,
    createdAt: num(doc.createdAt, Date.now()),
  };
}

export function toLaneView(doc: Record<string, unknown>): RoadmapLaneView {
  return {
    id: str(doc.id ?? doc._id),
    name: str(doc.name),
    states: arr(doc.states),
    order: num(doc.order),
  };
}
