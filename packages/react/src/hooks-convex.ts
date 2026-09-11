"use client";

/**
 * Convex-flavored hooks. Thin wrappers over `convex/react` that normalize
 * component results into backend-agnostic views (see views.ts). Import from
 * `@userr/react/convex` so apps on other backends never load `convex/react`.
 *
 * Function references come from the host's generated bindings, e.g.
 * `components.userr.items.list`. They are typed structurally — any reference
 * with a compatible shape works.
 */
import {
  useMutation as useConvexMutationHook,
  usePaginatedQuery,
  useQuery as useConvexQueryHook,
} from "convex/react";
import type { FunctionReference } from "convex/server";

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

type AnyQuery = FunctionReference<"query", "public", any, any>;
type AnyMutation = FunctionReference<"mutation", "public", any, any>;

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object" && Array.isArray((value as { page?: unknown }).page)) {
    return (value as { page: Record<string, unknown>[] }).page;
  }
  return [];
}

export function useConvexItems(
  listQuery: AnyQuery,
  args: {
    boardId: string;
    state?: string;
    moderation?: string;
    initialNumItems?: number;
  },
): {
  items: BoardItemView[];
  status: "LoadingMore" | "CanLoadMore" | "Exhausted" | string;
  loadMore: (n: number) => void;
} {
  const { results, status, loadMore } = usePaginatedQuery(
    listQuery as never,
    {
      boardId: args.boardId,
      ...(args.state ? { state: args.state } : {}),
      ...(args.moderation ? { moderation: args.moderation } : {}),
    } as never,
    { initialNumItems: args.initialNumItems ?? 20 },
  );
  return {
    items: (results as unknown[]).map((doc) =>
      toBoardItemView(doc as Record<string, unknown>),
    ),
    status: status as string,
    loadMore,
  };
}

export function useConvexTopItems(
  listTopQuery: AnyQuery,
  args: { boardId: string; state?: string },
): BoardItemView[] | undefined {
  const results = useConvexQueryHook(listTopQuery as never, {
    boardId: args.boardId,
    ...(args.state ? { state: args.state } : {}),
  } as never);
  if (results === undefined) return undefined;
  return rows(results).map(toBoardItemView);
}

export function useConvexItem(
  getQuery: AnyQuery,
  args: { itemId: string; viewerActorId?: string } | "skip",
): {
  item: BoardItemView;
  viewerHasVoted: boolean;
  viewerIsSubscribed: boolean;
} | null | undefined {
  const result = useConvexQueryHook(
    getQuery as never,
    args === "skip"
      ? "skip"
      : ({
          itemId: args.itemId,
          ...(args.viewerActorId ? { viewerActorId: args.viewerActorId } : {}),
        } as never),
  );
  if (result === undefined) return undefined;
  if (result === null) return null;
  const doc = result as unknown as {
    item: Record<string, unknown>;
    viewerHasVoted: boolean;
    viewerIsSubscribed: boolean;
  };
  return {
    item: toBoardItemView(doc.item),
    viewerHasVoted: doc.viewerHasVoted,
    viewerIsSubscribed: doc.viewerIsSubscribed,
  };
}

export function useConvexVote(
  voteMutation: AnyMutation,
  unvoteMutation: AnyMutation,
): (args: { itemId: string; actorId: string; next: boolean }) => Promise<unknown> {
  const vote = useConvexMutationHook(voteMutation as never);
  const unvote = useConvexMutationHook(unvoteMutation as never);
  return ({ itemId, actorId, next }: { itemId: string; actorId: string; next: boolean }) =>
    (next ? vote : unvote)({ itemId, actorId } as never) as Promise<unknown>;
}

export function useConvexComments(
  listQuery: AnyQuery,
  args: { itemId: string; initialNumItems?: number },
): { comments: CommentView[]; status: string; loadMore: (n: number) => void } {
  const { results, status, loadMore } = usePaginatedQuery(
    listQuery as never,
    { itemId: args.itemId } as never,
    { initialNumItems: args.initialNumItems ?? 20 },
  );
  return {
    comments: (results as unknown[]).map((doc) =>
      toCommentView(doc as Record<string, unknown>),
    ),
    status: status as string,
    loadMore,
  };
}

export function useConvexChangelog(
  listQuery: AnyQuery,
  args: { boardId: string; initialNumItems?: number },
): {
  entries: ChangelogEntryView[];
  status: string;
  loadMore: (n: number) => void;
} {
  const { results, status, loadMore } = usePaginatedQuery(
    listQuery as never,
    { boardId: args.boardId } as never,
    { initialNumItems: args.initialNumItems ?? 20 },
  );
  return {
    entries: (results as unknown[]).map((doc) =>
      toChangelogEntryView(doc as Record<string, unknown>),
    ),
    status: status as string,
    loadMore,
  };
}

export function useConvexLanes(
  listQuery: AnyQuery,
  args: { boardId: string } | "skip",
): RoadmapLaneView[] | undefined {
  const results = useConvexQueryHook(
    listQuery as never,
    args === "skip" ? "skip" : ({ boardId: args.boardId } as never),
  );
  if (results === undefined) return undefined;
  return rows(results).map(toLaneView);
}
