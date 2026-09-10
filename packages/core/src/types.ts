export type Id = string;

export type FeedbackKind = "idea" | "bug" | "feedback" | "support";
export type Visibility = "public" | "private";
export type ItemState = "inbox" | "open" | "planned" | "in_progress" | "shipped" | "closed" | "merged";
export type Role = "viewer" | "member" | "moderator" | "admin" | "owner";

export interface Actor {
  id: string;
  organizationId?: string;
  email?: string;
  displayName?: string;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface Board {
  id: Id;
  slug: string;
  name: string;
  visibility: Visibility;
  allowedKinds: readonly FeedbackKind[];
  statusOrder: readonly ItemState[];
}

export interface FeedbackItem {
  id: Id;
  boardId: Id;
  publicId: string;
  slug: string;
  title: string;
  body: string;
  kind: FeedbackKind;
  state: ItemState;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  voteCount: number;
  commentCount: number;
  mergedInto?: Id;
  labels: readonly string[];
  context?: Record<string, string | number | boolean | null>;
}

export interface FeedbackEvent {
  id: Id;
  itemId: Id;
  type: "created" | "state_changed" | "merged" | "vote_added" | "vote_removed" | "commented";
  actorId?: string;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface CursorPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface StatusTransition {
  from: ItemState;
  to: ItemState;
  roles: readonly Role[];
}

export interface PermissionResolver {
  roleFor(actor: Actor, boardId: Id): Role | null | Promise<Role | null>;
}

export interface ActorResolver {
  current(): Actor | null | Promise<Actor | null>;
}

export interface BoardInput {
  slug: string;
  name: string;
  visibility: Visibility;
  allowedKinds: readonly FeedbackKind[];
  statusOrder: readonly ItemState[];
}

export interface ItemInput {
  boardId: Id;
  title: string;
  body: string;
  kind: FeedbackKind;
  authorId: string;
  context?: Record<string, string | number | boolean | null>;
}

export interface FeedbackRepository {
  createBoard(input: BoardInput): Promise<Board>;
  createItem(input: ItemInput): Promise<FeedbackItem>;
  findItem(id: Id): Promise<FeedbackItem | null>;
  findCanonicalItem(id: Id): Promise<FeedbackItem | null>;
  listItems(input: { boardId: Id; cursor?: string; limit: number; state?: ItemState }): Promise<CursorPage<FeedbackItem>>;
  castVote(input: { itemId: Id; actorId: string }): Promise<{ added: boolean; voteCount: number }>;
  uncastVote(input: { itemId: Id; actorId: string }): Promise<{ removed: boolean; voteCount: number }>;
  setState(input: { itemId: Id; state: ItemState; actorId: string }): Promise<void>;
  merge(input: MergePlan): Promise<void>;
  appendEvent(event: Omit<FeedbackEvent, "id">): Promise<void>;
  listEvents(input: { itemId: Id }): Promise<readonly FeedbackEvent[]>;
}

export interface EmbeddingProvider {
  embed(input: { text: string }): Promise<readonly number[]>;
  dimensions: number;
}

export interface BlobStore {
  put(input: { key: string; contentType: string; bytes: Uint8Array }): Promise<{ key: string; url?: string }>;
  remove(key: string): Promise<void>;
}

export interface NotificationProvider {
  deliver(input: { idempotencyKey: string; event: FeedbackEvent; recipients: readonly Actor[] }): Promise<void>;
}

export interface RealtimeAdapter {
  publish(input: { topic: string; event: FeedbackEvent }): Promise<void>;
}

export interface IntegrationAdapter {
  key: string;
  handle(event: FeedbackEvent): Promise<void>;
}

export interface MergePlan {
  sourceId: Id;
  targetId: Id;
  actorId: string;
  mergedAt: number;
  reason?: string;
}
