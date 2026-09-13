"use client";

import { useState } from "react";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import { useHotkeys } from "./use-hotkeys.js";
import type { BoardItemView } from "./views.js";
import { FeedbackCard } from "./feedback-card.js";

export interface TriageInboxProps {
  items: readonly BoardItemView[];
  hasMore?: boolean;
  loading?: boolean;
  onBulkState?: (ids: string[], state: "planned" | "closed") => Promise<void> | void;
  onOpen?: (id: string) => void;
  onLoadMore?: () => void;
  className?: string;
}

/** Triage inbox: unreviewed items sorted by votes, checkbox multi-select,
 *  bulk plan/close, and keyboard shortcuts (p/c). Selection is local;
 *  persistence happens through onBulkState. */
export function TriageInbox({
  items,
  hasMore,
  loading,
  onBulkState,
  onOpen,
  onLoadMore,
  className,
}: TriageInboxProps) {
  const messages = useFeedbackMessages();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length
        ? new Set()
        : new Set(items.map((i) => i.id)),
    );
  }

  async function applyBulk(state: "planned" | "closed") {
    if (selected.size === 0 || !onBulkState) return;
    setBusy(true);
    try {
      await onBulkState([...selected], state);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  useHotkeys({
    p: () => void applyBulk("planned"),
    c: () => void applyBulk("closed"),
    a: () => toggleAll(),
  });

  return (
    <div className={cn("grid gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">{messages.triageInbox}</h2>
        <span className="text-xs" style={{ color: "var(--userr-muted)" }}>
          {messages.bulkSelected(selected.size)}
        </span>
        <button
          onClick={toggleAll}
          className="rounded-md border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--userr-border)" }}
        >
          {messages.selectAll}
        </button>
        <button
          onClick={() => void applyBulk("planned")}
          disabled={busy || selected.size === 0}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--userr-accent)" }}
        >
          {messages.bulkPlan} (p)
        </button>
        <button
          onClick={() => void applyBulk("closed")}
          disabled={busy || selected.size === 0}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          style={{ borderColor: "var(--userr-border)" }}
        >
          {messages.bulkClose} (c)
        </button>
      </div>
      {items.length === 0 && !loading ? (
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
            <div key={item.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                aria-label={`Select ${item.title}`}
                className="mt-5"
              />
              <div className="flex-1">
                <FeedbackCard
                  item={item}
                  onOpen={onOpen ? () => onOpen(item.id) : undefined}
                />
              </div>
            </div>
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
      <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
        {messages.shortcutsHelp}
      </p>
    </div>
  );
}
