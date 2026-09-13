import {
  authorizeWidgetSubmission,
  assertTransition,
  type AtomicRateLimiter,
  type ItemState,
  type RateLimitRequest,
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

export interface WidgetHostHandlerOptions {
  secret: string;
  networkFingerprint: (req: Request) => string | Promise<string>;
  consumeAllOrNothing: AtomicRateLimiter["consumeAllOrNothing"];
  createItem: (input: { boardId: string; actorId: string; title: string; body: string; kind: "bug" | "idea" | "feedback" | "support" }) => Promise<unknown>;
  /** Defaults to `feedback`, matching new boards. Set `support` for a legacy
   * board whose allowedKinds contains support instead. */
  questionKind?: "feedback" | "support";
  subjectLimit?: Omit<RateLimitRequest, "key">;
  networkLimit?: Omit<RateLimitRequest, "key">;
}

/** Host-side Web Request handler for a Convex-backed widget endpoint. Token
 * verification and network hashing stay in the host; callbacks bridge only
 * rate-limit requests and validated item data into component mutations. */
export function createWidgetHostHandler(options: WidgetHostHandlerOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
    let body: Record<string, unknown>;
    try { const value = await req.json() as unknown; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); body = value as Record<string, unknown>; }
    catch { return Response.json({ error: "Body must be valid JSON object." }, { status: 400 }); }
    const text = (key: string): string | null => typeof body[key] === "string" && body[key].length > 0 ? body[key] : null;
    const boardId = text("boardId"); const token = text("hostToken"); const title = text("title"); const category = text("category");
    if (!boardId || !token || !title || !category) return Response.json({ error: "boardId, hostToken, title, and category are required." }, { status: 400 });
    let networkFingerprint: string;
    try { networkFingerprint = await options.networkFingerprint(req); }
    catch { return Response.json({ error: "Widget submission could not be authorized." }, { status: 500 }); }
    let authorization;
    try { authorization = await authorizeWidgetSubmission({ token, secret: options.secret, boardId, networkFingerprint, limiter: { consumeAllOrNothing: options.consumeAllOrNothing }, ...(options.subjectLimit ? { subjectLimit: options.subjectLimit } : {}), ...(options.networkLimit ? { networkLimit: options.networkLimit } : {}) }); }
    catch { return Response.json({ error: "Widget submission could not be authorized." }, { status: 500 }); }
    if (!authorization.allowed) {
      if (authorization.reason !== "rate_limited") return Response.json({ error: "Widget host token is invalid." }, { status: 401 });
      const headers = new Headers(); if (authorization.retryAfterMs !== undefined) headers.set("retry-after", String(Math.max(1, Math.ceil(authorization.retryAfterMs / 1000))));
      return Response.json({ error: "Widget submission rate limit exceeded." }, { status: 429, headers });
    }
    const kinds = { bug: "bug", feature: "idea", question: options.questionKind ?? "feedback" } as const;
    if (!Object.hasOwn(kinds, category)) return Response.json({ error: "category must be bug, feature, or question." }, { status: 400 });
    try {
      const item = await options.createItem({ boardId, actorId: authorization.claims.subject, title, body: typeof body.body === "string" ? body.body : "", kind: kinds[category as keyof typeof kinds] });
      return Response.json(item, { status: 201 });
    } catch {
      return Response.json({ error: "Widget submission could not be created." }, { status: 500 });
    }
  };
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
