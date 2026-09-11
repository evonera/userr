import { useState } from "react";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView } from "./views.js";

export interface SimilarCandidate {
  id: string;
  title: string;
  voteCount: number;
}

export interface MergeReviewProps {
  source: BoardItemView;
  candidates: readonly SimilarCandidate[];
  loadingCandidates?: boolean;
  onMerge?: (sourceId: string, targetId: string) => Promise<void> | void;
  className?: string;
}
/** Duplicate triage: pick the canonical target, preview the vote transfer,
 *  confirm explicitly. Never merges automatically. Vote counts are labeled
 *  honestly: the target keeps its own votes; at most the source's votes move,
 *  minus overlaps. */
export function MergeReview({
  source,
  candidates,
  loadingCandidates,
  onMerge,
  className,
}: MergeReviewProps) {
  const messages = useFeedbackMessages();
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const target = candidates.find((c) => c.id === targetId);

  async function confirm() {
    if (!targetId || !onMerge) return;
    setBusy(true);
    try {
      await onMerge(source.id, targetId);
      setTargetId("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-3 rounded-[var(--userr-radius)] border p-4",
        className,
      )}
      style={{
        borderColor: "var(--userr-border)",
        background: "var(--userr-surface)",
        color: "var(--userr-text)",
      }}
    >
      <h3 className="text-sm font-bold">
        {messages.mergeReview}: {source.title}
      </h3>
      {loadingCandidates ? (
        <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
          …
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
          {messages.triageEmpty}
        </p>
      ) : (
        <ul className="grid gap-2">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`merge-${source.id}`}
                  checked={targetId === candidate.id}
                  onChange={() => setTargetId(candidate.id)}
                />
                <span className="flex-1">{candidate.title}</span>
                <span
                  className="text-xs"
                  style={{ color: "var(--userr-muted)" }}
                >
                  {candidate.voteCount} votes
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--userr-muted)" }}>
            {messages.mergeInto}
          </span>
          <button
            onClick={() => void confirm()}
            disabled={busy || !target}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--userr-accent)" }}
          >
            {messages.mergeConfirm}
            {target ? ` → ${target.title}` : ""}
          </button>
        </div>
        {target && (
          <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
            {messages.mergeVotesTransfer(source.voteCount)}
          </p>
        )}
      </div>
    </div>
  );
}
