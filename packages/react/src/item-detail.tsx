"use client";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import { StatusBadge, VoteButton } from "./atoms.js";
import { CommentThread } from "./comment-thread.js";
import type { BoardItemView, CommentView } from "./views.js";

export interface ItemDetailProps {
  item: BoardItemView;
  comments?: readonly CommentView[];
  voted?: boolean;
  subscribed?: boolean;
  onVote?: () => void;
  onSubscribe?: () => void;
  onReply?: (parentId: string | undefined, body: string) => Promise<void> | void;
  className?: string;
}

export function ItemDetail({
  item,
  comments = [],
  voted,
  subscribed,
  onVote,
  onSubscribe,
  onReply,
  className,
}: ItemDetailProps) {
  const messages = useFeedbackMessages();
  return (
    <article className={cn("grid gap-4", className)}>
      <div className="flex items-start gap-4">
        <VoteButton
          count={item.voteCount}
          voted={voted}
          title={item.title}
          onToggle={onVote}
        />
        <div className="grid flex-1 gap-2">
          <h1 className="text-xl font-bold">{item.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge state={item.state} />
            <span style={{ color: "var(--userr-muted)" }}>{item.kind}</span>
            {onSubscribe && (
              <button
                onClick={onSubscribe}
                aria-pressed={subscribed}
                className="rounded-full border px-3 py-1 font-medium"
                style={{ borderColor: "var(--userr-border)" }}
              >
                {subscribed ? "✓ " : ""}
                {subscribed ? messages.unsubscribe : messages.subscribe}
              </button>
            )}
          </div>
        </div>
      </div>
      {item.body && <p className="text-sm whitespace-pre-wrap">{item.body}</p>}
      <CommentThread comments={comments} onReply={onReply} />
    </article>
  );
}
