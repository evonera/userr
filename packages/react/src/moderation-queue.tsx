"use client";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView } from "./views.js";
import { FeedbackCard } from "./feedback-card.js";

export type ModerationDecision = "approved" | "rejected" | "spam";

export interface ModerationQueueProps {
  items: readonly BoardItemView[];
  onReview?: (id: string, decision: ModerationDecision) => Promise<void> | void;
  onOpen?: (id: string) => void;
  className?: string;
}

/** Pending-items queue: one-click approve/reject/spam per report. */
export function ModerationQueue({
  items,
  onReview,
  onOpen,
  className,
}: ModerationQueueProps) {
  const messages = useFeedbackMessages();
  return (
    <div className={cn("grid gap-4", className)}>
      <h2 className="text-lg font-bold">{messages.moderationQueue}</h2>
      {items.length === 0 ? (
        <p
          className="rounded-md border p-6 text-center text-sm"
          style={{
            borderColor: "var(--userr-border)",
            color: "var(--userr-muted)",
          }}
        >
          {messages.triageEmpty}
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.id} className="grid gap-2">
              <FeedbackCard
                item={item}
                onOpen={onOpen ? () => onOpen(item.id) : undefined}
              />
              <div className="flex gap-2">
                {(
                  [
                    ["approved", messages.approve],
                    ["rejected", messages.reject],
                    ["spam", messages.markSpam],
                  ] as const
                ).map(([decision, label]) => (
                  <button
                    key={decision}
                    onClick={() => onReview?.(item.id, decision)}
                    className="rounded-md border px-3 py-1.5 text-xs font-semibold"
                    style={{ borderColor: "var(--userr-border)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
