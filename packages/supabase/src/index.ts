import type { FeedbackEvent } from "@userr/core";

/** Host supplies the authenticated Supabase client; Userr never owns its keys. */
export interface BroadcastChannel {
  send(input: { type: "broadcast"; event: "feedback"; payload: FeedbackEvent }): Promise<unknown>;
}
export async function broadcastFeedback(channel: BroadcastChannel, event: FeedbackEvent): Promise<void> {
  await channel.send({ type: "broadcast", event: "feedback", payload: event });
}
export const SUPABASE_MIGRATION_PATH = "supabase/migrations/0001_userr_rls.sql";
