import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView } from "./views.js";
import { FeedbackCard } from "./feedback-card.js";

export type BoardSort = "top" | "new";

export interface BoardListProps {
  items: readonly BoardItemView[];
  votedIds?: ReadonlySet<string>;
  states?: readonly string[];
  hasMore?: boolean;
  loading?: boolean;
  onVote?: (id: string) => void;
  onOpen?: (id: string) => void;
  onSearch?: (query: string) => void;
  onSortChange?: (sort: BoardSort) => void;
  onStateChange?: (state: string | null) => void;
  onLoadMore?: () => void;
  className?: string;
}

export function BoardList({
  items,
  votedIds,
  states = [],
  hasMore,
  loading,
  onVote,
  onOpen,
  onSearch,
  onSortChange,
  onStateChange,
  onLoadMore,
  className,
}: BoardListProps) {
  const messages = useFeedbackMessages();
  const [sort, setSort] = useState<BoardSort>("top");
  const [activeState, setActiveState] = useState<string | null>(null);

  function changeSort(next: BoardSort) {
    setSort(next);
    onSortChange?.(next);
  }

  function changeState(next: string | null) {
    setActiveState(next);
    onStateChange?.(next);
  }

  return (
    <div className={cn("grid gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder={messages.boardSearchPlaceholder}
          aria-label={messages.boardSearchPlaceholder}
          onChange={(event) => onSearch?.(event.currentTarget.value)}
          className="min-w-52 flex-1 rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--userr-border)",
            background: "var(--userr-surface)",
            color: "var(--userr-text)",
          }}
        />
        <Tabs.Root
          value={sort}
          onValueChange={(value) => changeSort(value as BoardSort)}
        >
          <Tabs.List aria-label="Sort" className="flex gap-1">
            <Tabs.Trigger
              value="top"
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium data-[state=active]:text-white",
              )}
              style={
                sort === "top"
                  ? { background: "var(--userr-accent)" }
                  : undefined
              }
            >
              {messages.sortTop}
            </Tabs.Trigger>
            <Tabs.Trigger
              value="new"
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium data-[state=active]:text-white",
              )}
              style={
                sort === "new"
                  ? { background: "var(--userr-accent)" }
                  : undefined
              }
            >
              {messages.sortNew}
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      {states.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Filter by status">
          <button
            onClick={() => changeState(null)}
            aria-pressed={activeState === null}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              activeState === null && "font-semibold",
            )}
            style={{ borderColor: "var(--userr-border)" }}
          >
            {messages.filterAll}
          </button>
          {states.map((state) => (
            <button
              key={state}
              onClick={() => changeState(state)}
              aria-pressed={activeState === state}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                activeState === state && "font-semibold",
              )}
              style={{ borderColor: "var(--userr-border)" }}
            >
              {state.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 && !loading ? (
        <p
          className="rounded-md border p-6 text-center text-sm"
          style={{
            borderColor: "var(--userr-border)",
            color: "var(--userr-muted)",
          }}
        >
          {messages.boardEmpty}
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              voted={votedIds?.has(item.id)}
              onVote={onVote ? () => onVote(item.id) : undefined}
              onOpen={onOpen ? () => onOpen(item.id) : undefined}
            />
          ))}
        </div>
      )}
      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="justify-self-center rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--userr-border)" }}
        >
          {messages.boardLoadMore}
        </button>
      )}
    </div>
  );
}
