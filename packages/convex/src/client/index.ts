/**
 * Host wrappers are deliberately the authentication boundary. A host function
 * resolves its own user and capabilities, then invokes component functions.
 */
export interface FeedbackHostConfig {
  resolveActorId: () => Promise<string | null>;
  canModerate: (actorId: string, boardId: string) => Promise<boolean>;
}

export function requireActor(actorId: string | null): string {
  if (!actorId) throw new Error("Authentication is required for this feedback action.");
  return actorId;
}
