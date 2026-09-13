import type { FeedbackEvent } from "@userr/core";

/**
 * Supabase is Postgres. The transactional repository and framework-neutral
 * handler are deliberately shared with the generic Postgres adapter; this
 * package supplies Supabase migrations, RLS, and private Broadcast wiring.
 * Use a server-side Drizzle connection for mutations so host authorization
 * remains the single authority and service credentials never reach a browser.
 */
export {
  createRepository,
  createRequestHandler,
  toNextJsHandler,
  findSimilar,
  findSimilarVector,
  processOutbox,
  storeEmbedding,
  type Database,
  type HandlerOptions,
  type ProcessOutboxOptions,
} from "@userr/neon";
export * from "@userr/core";

export const SUPABASE_MIGRATION_PATHS = [
  "supabase/migrations/0000_userr_schema.sql",
  "supabase/migrations/0001_userr_rls.sql",
  "supabase/migrations/0002_userr_upgrade.sql",
  "supabase/migrations/0003_userr_rls_refresh.sql",
] as const;

/** Host supplies its already-authenticated Supabase channel; Userr owns no keys. */
export interface BroadcastChannel {
  send(input: {
    type: "broadcast";
    event: "feedback";
    payload: FeedbackEvent;
  }): Promise<unknown>;
}

export interface SupabaseChannelFactory<TChannel> {
  channel(topic: string, options: { config: { private: true } }): TChannel;
}

export function feedbackTopic(boardId: string): string {
  if (!boardId || boardId.includes(":")) {
    throw new Error("boardId must be a non-empty topic segment.");
  }
  return `feedback:${boardId}`;
}

/** Creates the private channel shape required by the included RLS policy. */
export function createPrivateFeedbackChannel<TChannel>(
  client: SupabaseChannelFactory<TChannel>,
  boardId: string,
): TChannel {
  return client.channel(feedbackTopic(boardId), { config: { private: true } });
}

export async function broadcastFeedback(
  channel: BroadcastChannel,
  event: FeedbackEvent,
): Promise<void> {
  await channel.send({ type: "broadcast", event: "feedback", payload: event });
}
