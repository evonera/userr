/**
 * REST client for the Neon handler routes (see @userr/neon/handler). Typed
 * fetch wrappers that normalize into the same backend-agnostic views the
 * Convex hooks produce. Import from `@userr/react/rest`.
 *
 * Pair with SWR (or any fetcher) in the host:
 *
 * ```tsx
 * import useSWR from "swr";
 * import { createRestClient } from "@userr/react/rest";
 *
 * const client = createRestClient({ baseUrl: "/api/userr" });
 * const { data } = useSWR(["items", boardId], () =>
 *   client.listItems({ boardId }),
 * );
 * ```
 */
import {
  toBoardItemView,
  toChangelogEntryView,
  toCommentView,
  toLaneView,
  type BoardItemView,
  type ChangelogEntryView,
  type CommentView,
  type RoadmapLaneView,
} from "./views.js";

export interface RestClientOptions {
  baseUrl: string;
  /** Attach auth (session cookie flows automatically; token hosts use this). */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

async function readJson(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : `Request failed (${res.status}).`,
    );
  }
  return body as never;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function createRestClient(options: RestClientOptions) {
  async function headers(): Promise<Record<string, string>> {
    return {
      "content-type": "application/json",
      ...((await options.getHeaders?.()) ?? {}),
    };
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${options.baseUrl}${path}`, {
      headers: await headers(),
    });
    return readJson(res);
  }

  async function send<T>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${options.baseUrl}${path}`, {
      method,
      headers: await headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readJson(res);
  }

  function paging<T>(raw: {
    items?: unknown;
    page?: unknown;
    nextCursor?: unknown;
  }): CursorPage<T> {
    const list = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.page)
        ? raw.page
        : [];
    return {
      items: list as T[],
      nextCursor:
        typeof raw.nextCursor === "string" ? raw.nextCursor : null,
    };
  }

  return {
    async getBoardBySlug(slug: string) {
      return get<Record<string, unknown>>(
        `/boards?slug=${encodeURIComponent(slug)}`,
      );
    },
    async createBoard(input: Record<string, unknown>) {
      return send<Record<string, unknown>>("/boards", "POST", input);
    },
    async listItems(input: {
      boardId: string;
      state?: string;
      limit?: number;
      cursor?: string;
    }): Promise<CursorPage<BoardItemView>> {
      const params = new URLSearchParams({ boardId: input.boardId });
      if (input.state) params.set("state", input.state);
      if (input.limit) params.set("limit", String(input.limit));
      if (input.cursor) params.set("cursor", input.cursor);
      const raw = await get<Record<string, unknown>>(
        `/items?${params.toString()}`,
      );
      const page = paging<Record<string, unknown>>(raw);
      return {
        items: page.items.map(toBoardItemView),
        nextCursor: page.nextCursor,
      };
    },
    async getItem(itemId: string): Promise<BoardItemView> {
      return toBoardItemView(
        await get<Record<string, unknown>>(`/items/${itemId}`),
      );
    },
    async createItem(input: Record<string, unknown>): Promise<BoardItemView> {
      return toBoardItemView(
        await send<Record<string, unknown>>("/items", "POST", input),
      );
    },
    async vote(itemId: string) {
      return send<{ added: boolean; voteCount: number }>(
        `/items/${itemId}/vote`,
        "POST",
      );
    },
    async unvote(itemId: string) {
      return send<{ removed: boolean; voteCount: number }>(
        `/items/${itemId}/vote`,
        "DELETE",
      );
    },
    async listComments(
      itemId: string,
      input: { limit?: number; cursor?: string } = {},
    ): Promise<CursorPage<CommentView>> {
      const params = new URLSearchParams();
      if (input.limit) params.set("limit", String(input.limit));
      if (input.cursor) params.set("cursor", input.cursor);
      const raw = await get<Record<string, unknown>>(
        `/items/${itemId}/comments?${params.toString()}`,
      );
      const page = paging<Record<string, unknown>>(raw);
      return {
        items: page.items.map(toCommentView),
        nextCursor: page.nextCursor,
      };
    },
    async createComment(
      itemId: string,
      input: { body: string; parentId?: string },
    ): Promise<{ id: string }> {
      return send<{ id: string }>(`/items/${itemId}/comments`, "POST", input);
    },
    async removeComment(commentId: string) {
      return send<{ ok: boolean }>(`/comments/${commentId}`, "DELETE");
    },
    async reportItem(itemId: string, input: { reason?: string } = {}) {
      return send<{ ok: boolean }>(`/items/${itemId}/report`, "POST", input);
    },
    async reviewItem(
      itemId: string,
      input: { decision: "approved" | "rejected" | "spam" },
    ) {
      return send<{ ok: boolean }>(`/items/${itemId}/review`, "POST", input);
    },
    async setStateMany(itemIds: string[], state: string, boardId: string) {
      return send<{ updated: number }>("/items/bulk/state", "POST", {
        boardId,
        itemIds,
        state,
      });
    },
    async moderationQueue(
      boardId: string,
      input: { limit?: number; cursor?: string } = {},
    ): Promise<CursorPage<BoardItemView>> {
      const params = new URLSearchParams({ boardId });
      if (input.limit) params.set("limit", String(input.limit));
      if (input.cursor) params.set("cursor", input.cursor);
      const raw = await get<Record<string, unknown>>(
        `/moderation?${params.toString()}`,
      );
      const page = paging<Record<string, unknown>>(raw);
      return {
        items: page.items.map(toBoardItemView),
        nextCursor: page.nextCursor,
      };
    },
    async blockActor(boardId: string, actorId: string, reason?: string) {
      return send<{ ok: boolean }>("/blocks", "POST", {
        boardId,
        actorId,
        ...(reason ? { reason } : {}),
      });
    },
    async unblockActor(boardId: string, actorId: string) {
      const params = new URLSearchParams({ boardId, actorId });
      return send<{ ok: boolean }>(`/blocks?${params.toString()}`, "DELETE");
    },
    async listWebhooks(boardId: string) {
      const params = new URLSearchParams({ boardId });
      return get<Record<string, unknown>[]>(
        `/webhooks?${params.toString()}`,
      );
    },
    async createWebhook(input: {
      boardId: string;
      url: string;
      events: string[];
    }) {
      return send<{ webhook: Record<string, unknown>; secret: string }>(
        "/webhooks",
        "POST",
        input,
      );
    },
    async subscribe(itemId: string, input: Record<string, unknown> = {}) {
      return send<{ ok: boolean }>(`/items/${itemId}/subscribe`, "POST", input);
    },
    async unsubscribe(itemId: string) {
      return send<{ removed: boolean }>(
        `/items/${itemId}/unsubscribe`,
        "DELETE",
      );
    },
    async findSimilar(input: { boardId: string; title: string }): Promise<{
      exact: string | null;
      similar: { id: string; title: string; voteCount: number }[];
    }> {
      const params = new URLSearchParams({
        boardId: input.boardId,
        title: input.title,
      });
      return get(`/similar?${params.toString()}`);
    },
    async listChangelog(input: {
      boardId: string;
      limit?: number;
      cursor?: string;
    }): Promise<CursorPage<ChangelogEntryView>> {
      const params = new URLSearchParams({ boardId: input.boardId });
      if (input.limit) params.set("limit", String(input.limit));
      if (input.cursor) params.set("cursor", input.cursor);
      const raw = await get<Record<string, unknown>>(
        `/changelog?${params.toString()}`,
      );
      const page = paging<Record<string, unknown>>(raw);
      return {
        items: page.items.map(toChangelogEntryView),
        nextCursor: page.nextCursor,
      };
    },
    async listLanes(input: {
      boardId: string;
    }): Promise<RoadmapLaneView[]> {
      const params = new URLSearchParams({ boardId: input.boardId });
      const raw = await get<Record<string, unknown>[]>(
        `/lanes?${params.toString()}`,
      );
      return (Array.isArray(raw) ? raw : []).map(toLaneView);
    },
    async publishChangelogEntry(input: {
      boardId: string;
      title: string;
      body: string;
      version?: string;
      linkedItemIds?: string[];
      publishedAt?: number;
    }): Promise<ChangelogEntryView> {
      return toChangelogEntryView(
        await send<Record<string, unknown>>("/changelog", "POST", input),
      );
    },
    async saveLane(input: {
      id?: string;
      boardId: string;
      name: string;
      states: string[];
      order: number;
    }): Promise<RoadmapLaneView> {
      return toLaneView(
        await send<Record<string, unknown>>("/lanes", "POST", input),
      );
    },
  };
}

export type RestClient = ReturnType<typeof createRestClient>;
