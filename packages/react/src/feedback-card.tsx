"use client";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView } from "./views.js";
import { StatusBadge, VoteButton } from "./atoms.js";

export interface FeedbackCardProps {
  item: BoardItemView;
  voted?: boolean;
  onVote?: () => void;
  onOpen?: () => void;
  className?: string;
}

export function FeedbackCard({
  item,
  voted,
  onVote,
  onOpen,
  className,
}: FeedbackCardProps) {
  const messages = useFeedbackMessages();
  return (
    <article
      className={cn(
        "grid grid-cols-[auto_1fr] gap-4 rounded-[var(--userr-radius)] border p-4",
        className,
      )}
      style={{
        background: "var(--userr-surface)",
        color: "var(--userr-text)",
        borderColor: "var(--userr-border)",
      }}
    >
      <VoteButton
        count={item.voteCount}
        voted={voted}
        title={item.title}
        onToggle={onVote}
      />
      <div>
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer bg-transparent p-0 text-left text-base font-bold"
          style={{ color: "inherit" }}
        >
          {item.title}
        </button>
        {item.body && (
          <p className="mb-2 line-clamp-2 text-sm">{item.body}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge state={item.state} />
          <span style={{ color: "var(--userr-muted)" }}>
            {item.kind} · {messages.comments(item.commentCount)}
          </span>
          {item.labels.map((label) => (
            <span
              key={label}
              className="rounded-full border px-2 py-0.5"
              style={{ borderColor: "var(--userr-border)" }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
