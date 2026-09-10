import type { FeedbackItem } from "@userr/core";

export interface FeedbackCardProps {
  item: Pick<FeedbackItem, "title" | "body" | "kind" | "state" | "voteCount" | "commentCount" | "labels">;
  voted?: boolean;
  onVote?: () => void;
  onOpen?: () => void;
}

export function FeedbackCard({ item, voted, onVote, onOpen }: FeedbackCardProps) {
  return <article style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.9rem", padding: "1rem", background: "var(--lf-surface)", color: "var(--lf-text)", border: "1px solid #e5e7eb", borderRadius: "var(--lf-radius)" }}>
    <button type="button" aria-pressed={voted} onClick={onVote} aria-label={`Vote for ${item.title}`} style={{ alignSelf: "start", minWidth: 48 }}>▲ {item.voteCount}</button>
    <div>
      <button type="button" onClick={onOpen} style={{ background: "none", border: 0, padding: 0, color: "inherit", fontWeight: 700, fontSize: "1rem", cursor: "pointer" }}>{item.title}</button>
      {item.body && <p style={{ marginBottom: "0.5rem" }}>{item.body}</p>}
      <small>{item.kind} · {item.state} · {item.commentCount} comments</small>
      {item.labels.length > 0 && <div aria-label="Labels">{item.labels.map((label) => <span key={label} style={{ marginLeft: "0.35rem" }}>{label}</span>)}</div>}
    </div>
  </article>;
}
