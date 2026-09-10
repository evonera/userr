import {
  assertTransition,
  ITEM_STATES,
  type FeedbackRepository,
  type ItemState,
  type Role,
  type StatusTransition,
} from "@userr/core";

import {
  createComment,
  createRepository,
  findSimilar,
  getBoard,
  getBoardBySlug,
  getComment,
  listComments,
  removeComment,
  subscribe,
  unsubscribe,
  type Database,
} from "./repository.js";

export interface HandlerOptions {
  db: Database;
  /** Resolve the caller to an opaque actor ID (session, JWT, API key). */
  identify: (req: Request) => Promise<string | null>;
  /** Resolve an actor's board role. Absent: moderator paths reject (fail-closed). */
  resolveRole?: (actorId: string, boardId: string) => Promise<Role | null>;
  /** Allowed status transitions; enforced before setState when provided. */
  transitions?: readonly StatusTransition[];
  /**
   * Decide whether a caller may read a board's content. Defaults: public
   * boards are world-readable; private boards deny everyone unless this hook
   * is provided (fail-closed). The hook receives null for anonymous callers.
   */
  canReadBoard?: (
    actorId: string | null,
    board: { id: string; visibility: string },
  ) => boolean | Promise<boolean>;
}

const MODERATOR_ROLES: readonly Role[] = ["moderator", "admin", "owner"];

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function failure(message: string, status: number): Response {
  return json({ error: message }, status);
}

function toStatus(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Unknown error";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  // Core domain errors carry machine-readable codes; prefer them over text.
  if (code === "PERMISSION_DENIED") return failure(message, 403);
  if (code === "INVALID_TRANSITION") return failure(message, 400);
  if (code === "MERGE_CONFLICT") return failure(message, 409);
  if (/authentication is required/i.test(message)) {
    return failure(message, 401);
  }
  if (/not found|unavailable/i.test(message)) return failure(message, 404);
  if (/moderation|permission/i.test(message)) return failure(message, 403);
  if (/taken|already/i.test(message)) return failure(message, 409);
  if (/valid JSON|must be a JSON object/i.test(message)) {
    return failure(message, 400);
  }
  if (/required|allowed|limit|invalid|empty/i.test(message)) {
    return failure(message, 400);
  }
  return failure(message, 500);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Body must be a JSON object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && /JSON object/.test(error.message)) throw error;
    throw new Error("Body must be valid JSON.");
  }
}

function str(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/**
 * Framework-agnostic handler: `(Request) => Response` over web standards.
 * Mount it in Next.js with `toNextJsHandler`, or adapt it to any runtime
 * (Hono, Elysia, TanStack Start) with the same one-line shape BetterAuth uses
 * for its framework integrations.
 *
 * Paths are matched on trailing resource segments so the handler works as a
 * catch-all (e.g. `/api/userr/[...path]`). Every board-scoped route passes a
 * visibility gate: public boards are world-readable, private boards require
 * the host's `canReadBoard` hook (fail-closed without it).
 *
 *   GET    /boards?slug=            board lookup
 *   POST   /boards                  create board (authenticated)
 *   GET    /items?boardId&state&limit&cursor
 *   POST   /items                   create item (authenticated)
 *   GET    /items/:id               single item
 *   POST   /items/:id/vote          vote (authenticated)
 *   DELETE /items/:id/vote          unvote (authenticated)
 *   POST   /items/:id/state         transition (moderator)
 *   POST   /items/:id/merge         merge (moderator)
 *   GET    /items/:id/events        audit trail
 *   GET    /items/:id/comments      list comments
 *   POST   /items/:id/comments      comment (authenticated)
 *   DELETE /comments/:id            remove comment (author or moderator)
 *   POST   /items/:id/subscribe     subscribe (authenticated)
 *   DELETE /items/:id/unsubscribe   unsubscribe (authenticated)
 *   GET    /similar?boardId&title   lexical duplicate suggestions
 *   GET    /changelog?boardId       changelog entries (newest first)
 *   GET    /lanes?boardId           roadmap lanes in order
 */
export function createRequestHandler(
  options: HandlerOptions,
): (req: Request) => Promise<Response> {
  const repo: FeedbackRepository = createRepository(options.db);

  async function actor(req: Request): Promise<string> {
    let actorId: string | null = null;
    try {
      actorId = await options.identify(req);
    } catch {
      actorId = null;
    }
    if (!actorId) throw new Error("Authentication is required.");
    return actorId;
  }

  async function moderator(req: Request, boardId: string): Promise<string> {
    const actorId = await actor(req);
    if (!options.resolveRole) {
      throw new Error("Moderation is not configured for this backend.");
    }
    const role = await options.resolveRole(actorId, boardId);
    if (!role || !MODERATOR_ROLES.includes(role)) {
      throw new Error("Moderation rights are required.");
    }
    return actorId;
  }

  async function optionalActor(req: Request): Promise<string | null> {
    try {
      return await options.identify(req);
    } catch {
      return null;
    }
  }

  /**
   * Board visibility gate. Every board-scoped route — reads and writes —
   * passes through here: public boards are world-readable, private boards
   * require the host's canReadBoard hook (fail-closed without it).
   */
  async function requireBoard(req: Request, boardId: string) {
    const board = await getBoard(options.db, boardId);
    if (!board) throw new Error("Board not found.");
    return checkBoard(req, board);
  }

  async function checkBoard(
    req: Request,
    board: { id: string; visibility: string },
  ) {
    if (board.visibility === "public") return board;
    const actorId = await optionalActor(req);
    const allowed = options.canReadBoard
      ? await options.canReadBoard(actorId, {
          id: board.id,
          visibility: board.visibility,
        })
      : false;
    if (!allowed) throw new Error("Permission denied for this board.");
    return board;
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const query = url.searchParams;
    // Route on trailing segments so any mount prefix works.
    const anchor = segments.findIndex((s) =>
      ["boards", "items", "comments", "similar", "changelog", "lanes"].includes(
        s,
      ),
    );
    const parts = anchor === -1 ? [] : segments.slice(anchor);

    try {
      // GET /boards?slug=
      if (req.method === "GET" && parts[0] === "boards") {
        const slug = query.get("slug");
        if (!slug) return failure("slug is required.", 400);
        const board = await getBoardBySlug(options.db, slug);
        if (!board) return failure("Board not found.", 404);
        await checkBoard(req, board);
        return json(board);
      }
      // POST /boards
      if (req.method === "POST" && parts[0] === "boards" && parts.length === 1) {
        await actor(req);
        const body = await readBody(req);
        const board = await repo.createBoard({
          slug: str(body.slug, "slug"),
          name: str(body.name, "name"),
          visibility:
            body.visibility === "private" ? "private" : "public",
          allowedKinds: Array.isArray(body.allowedKinds)
            ? (body.allowedKinds as ("idea" | "bug" | "feedback" | "support")[])
            : ["idea", "bug", "feedback"],
          statusOrder: Array.isArray(body.statusOrder)
            ? (body.statusOrder as never[])
            : ["inbox", "open", "planned", "in_progress", "shipped", "closed"],
        });
        return json(board, 201);
      }
      // GET /items?boardId&state&limit&cursor
      if (req.method === "GET" && parts[0] === "items" && parts.length === 1) {
        const boardId = query.get("boardId");
        if (!boardId) return failure("boardId is required.", 400);
        await requireBoard(req, boardId);
        return json(
          await repo.listItems({
            boardId,
            state: (query.get("state") as never) ?? undefined,
            limit: Math.min(Number(query.get("limit") ?? 20), 100),
            cursor: query.get("cursor") ?? undefined,
          }),
        );
      }
      // POST /items
      if (req.method === "POST" && parts[0] === "items" && parts.length === 1) {
        const actorId = await actor(req);
        const body = await readBody(req);
        const boardId = str(body.boardId, "boardId");
        await requireBoard(req, boardId);
        const item = await repo.createItem({
          boardId,
          title: str(body.title, "title"),
          body: typeof body.body === "string" ? body.body : "",
          kind: (body.kind as never) ?? "feedback",
          authorId: actorId,
        });
        return json(item, 201);
      }
      // GET /similar?boardId&title
      if (req.method === "GET" && parts[0] === "similar") {
        const boardId = query.get("boardId");
        const title = query.get("title") ?? "";
        if (!boardId) return failure("boardId is required.", 400);
        await requireBoard(req, boardId);
        return json(await findSimilar(options.db, { boardId, title }));
      }
      // GET /changelog?boardId&limit&cursor
      if (req.method === "GET" && parts[0] === "changelog") {
        const boardId = query.get("boardId");
        if (!boardId) return failure("boardId is required.", 400);
        await requireBoard(req, boardId);
        return json(
          await repo.listChangelog({
            boardId,
            limit: Math.min(Number(query.get("limit") ?? 20), 100),
            cursor: query.get("cursor") ?? undefined,
          }),
        );
      }
      // GET /lanes?boardId
      if (req.method === "GET" && parts[0] === "lanes") {
        const boardId = query.get("boardId");
        if (!boardId) return failure("boardId is required.", 400);
        await requireBoard(req, boardId);
        return json(await repo.listLanes({ boardId }));
      }
      // Item-scoped routes: /items/:id/...
      if (parts[0] === "items" && parts[1]) {
        const itemId = parts[1];
        const item = await repo.findItem(itemId);
        if (!item) return failure("Feedback item not found.", 404);
        await requireBoard(req, item.boardId);

        if (req.method === "GET" && parts.length === 2) {
          return json(item);
        }
        if (parts[2] === "vote" && req.method === "POST") {
          return json(
            await repo.castVote({ itemId, actorId: await actor(req) }),
          );
        }
        if (parts[2] === "vote" && req.method === "DELETE") {
          return json(
            await repo.uncastVote({ itemId, actorId: await actor(req) }),
          );
        }
        if (parts[2] === "state" && req.method === "POST") {
          const body = await readBody(req);
          const next = str(body.state, "state");
          // Contract first: the store only persists known states, and
          // `merged` is reachable solely through the merge operation.
          if (
            !(ITEM_STATES as readonly string[]).includes(next) ||
            next === "merged"
          ) {
            return failure(
              `Invalid state "${next}". Expected one of: ${ITEM_STATES.filter(
                (s) => s !== "merged",
              ).join(", ")}.`,
              400,
            );
          }
          const moderatorId = await moderator(req, item.boardId);
          if (options.transitions && options.resolveRole) {
            const role = await options.resolveRole(moderatorId, item.boardId);
            assertTransition({
              current: item.state,
              next: next as ItemState,
              role,
              transitions: options.transitions,
            });
          }
          await repo.setState({
            itemId,
            state: next as ItemState,
            actorId: moderatorId,
          });
          return json({ ok: true });
        }
        if (parts[2] === "merge" && req.method === "POST") {
          const body = await readBody(req);
          const moderatorId = await moderator(req, item.boardId);
          await repo.merge({
            sourceId: itemId,
            targetId: str(body.targetId, "targetId"),
            actorId: moderatorId,
            mergedAt: Date.now(),
            reason:
              typeof body.reason === "string" ? body.reason : undefined,
          });
          return json({ ok: true });
        }
        if (parts[2] === "events" && req.method === "GET") {
          return json(await repo.listEvents({ itemId }));
        }
        if (parts[2] === "comments" && req.method === "GET") {
          return json(
            await listComments(options.db, {
              itemId,
              limit: Math.min(Number(query.get("limit") ?? 20), 100),
              cursor: query.get("cursor") ?? undefined,
            }),
          );
        }
        if (parts[2] === "comments" && req.method === "POST") {
          const actorId = await actor(req);
          const body = await readBody(req);
          const commentId = await createComment(options.db, {
            itemId,
            actorId,
            body: str(body.body, "body"),
            parentId:
              typeof body.parentId === "string" ? body.parentId : undefined,
          });
          return json({ id: commentId }, 201);
        }
        if (parts[2] === "subscribe" && req.method === "POST") {
          const actorId = await actor(req);
          const body = await readBody(req).catch(
            (): Record<string, unknown> => ({}),
          );
          await subscribe(options.db, {
            itemId,
            actorId,
            notifyComments:
              typeof body.notifyComments === "boolean"
                ? body.notifyComments
                : undefined,
            notifyStatusChanges:
              typeof body.notifyStatusChanges === "boolean"
                ? body.notifyStatusChanges
                : undefined,
          });
          return json({ ok: true });
        }
        if (parts[2] === "unsubscribe" && req.method === "DELETE") {
          const removed = await unsubscribe(options.db, {
            itemId,
            actorId: await actor(req),
          });
          return json({ removed });
        }
      }
      // DELETE /comments/:id — role resolved against the comment's board.
      if (parts[0] === "comments" && parts[1] && req.method === "DELETE") {
        const actorId = await actor(req);
        const comment = await getComment(options.db, parts[1]);
        if (!comment) return failure("Comment is unavailable.", 404);
        const item = await repo.findItem(comment.itemId);
        let asModerator = false;
        if (item && options.resolveRole) {
          const role = await options.resolveRole(actorId, item.boardId);
          asModerator = !!role && MODERATOR_ROLES.includes(role);
        }
        await removeComment(options.db, {
          commentId: parts[1],
          actorId,
          asModerator,
        });
        return json({ ok: true });
      }
      return failure("Unknown route.", 404);
    } catch (error) {
      return toStatus(error);
    }
  };
}

/** Next.js App Router wiring for `app/api/userr/[...path]/route.ts`:
 *  `export const { GET, POST } = toNextJsHandler(options);` */
export function toNextJsHandler(options: HandlerOptions): {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
  DELETE: (req: Request) => Promise<Response>;
} {
  const handle = createRequestHandler(options);
  return { GET: handle, POST: handle, PATCH: handle, DELETE: handle };
}
