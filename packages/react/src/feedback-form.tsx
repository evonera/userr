import { useId, useState, type FormEvent } from "react";
import type { FeedbackKind } from "@userr/core";

export interface FeedbackFormValue { title: string; body: string; kind: FeedbackKind; }
export interface FeedbackFormProps { onSubmit(value: FeedbackFormValue): void | Promise<void>; kinds?: readonly FeedbackKind[]; }

export function FeedbackForm({ onSubmit, kinds = ["idea", "bug", "feedback", "support"] }: FeedbackFormProps) {
  const titleId = useId(); const bodyId = useId(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError(undefined);
    try { await onSubmit({ title: String(values.get("title") ?? "").trim(), body: String(values.get("body") ?? "").trim(), kind: String(values.get("kind")) as FeedbackKind }); event.currentTarget.reset(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit feedback."); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} aria-busy={busy} style={{ display: "grid", gap: "0.75rem" }}>
    <label htmlFor={titleId}>What would you like to share?</label><input id={titleId} name="title" required maxLength={160} />
    <label htmlFor={bodyId}>Details</label><textarea id={bodyId} name="body" rows={5} maxLength={10_000} />
    <label>Type <select name="kind">{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}<button disabled={busy} type="submit">{busy ? "Submitting…" : "Submit feedback"}</button>
  </form>;
}
