import {
  assertTransition,
  type ItemState,
  type Role,
  type StatusTransition,
} from "@userr/core";

/**
 * Host wrappers are deliberately the authentication boundary. A host function
 * resolves its own user and capabilities, then invokes component functions.
 * The component trusts these wrappers and never inspects a user table.
 */
export interface FeedbackHostConfig {
  resolveActorId: () => Promise<string | null>;
  /** Role of an actor on a board, resolved by the host (session, JWT, DB). */
  resolveRole?: (
    actorId: string,
    boardId: string,
  ) => Promise<Role | null>;
  /** Allowed status transitions with the roles permitted to perform each. */
  transitions?: readonly StatusTransition[];
  /** Legacy capability check. Prefer `resolveRole` + `transitions`. */
  canModerate?: (actorId: string, boardId: string) => Promise<boolean>;
}

export function requireActor(actorId: string | null): string {
  if (!actorId) throw new Error("Authentication is required for this feedback action.");
  return actorId;
}

export async function requireRole(
  config: FeedbackHostConfig,
  boardId: string,
  allowed: readonly Role[],
): Promise<{ actorId: string; role: Role }> {
  const actorId = requireActor(await config.resolveActorId());
  const role = (await config.resolveRole?.(actorId, boardId)) ?? null;
  if (!role || !allowed.includes(role)) {
    throw new Error("The actor cannot perform this feedback action.");
  }
  return { actorId, role };
}

export async function requireModerator(
  config: FeedbackHostConfig,
  boardId: string,
): Promise<string> {
  const actorId = requireActor(await config.resolveActorId());
  if (config.resolveRole) {
    const role = await config.resolveRole(actorId, boardId);
    if (
      role === "moderator" ||
      role === "admin" ||
      role === "owner"
    ) {
      return actorId;
    }
    throw new Error("Moderation rights are required.");
  }
  if (config.canModerate && (await config.canModerate(actorId, boardId))) {
    return actorId;
  }
  throw new Error("Moderation rights are required.");
}

/**
 * Validate a status change against the host's configured transitions before
 * calling the component's `setState`. Throws `FeedbackRuleError` on invalid
 * transitions or insufficient role.
 */
export function assertTransitionAllowed(
  config: FeedbackHostConfig,
  current: ItemState,
  next: ItemState,
  role: Role | null,
): void {
  assertTransition({
    current,
    next,
    role,
    transitions: config.transitions ?? [],
  });
}
