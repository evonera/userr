import { useId, useState, type FormEvent } from "react";
import type { FeedbackKind } from "@userr/core";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";

export interface FeedbackFormValue {
  title: string;
  body: string;
  kind: FeedbackKind;
}

export interface FeedbackFormProps {
  onSubmit(value: FeedbackFormValue): void | Promise<void>;
  kinds?: readonly FeedbackKind[];
  similar?: readonly { id: string; title: string; voteCount: number }[];
  className?: string;
}

export function FeedbackForm({
  onSubmit,
  kinds = ["idea", "bug", "feedback", "support"],
  similar = [],
  className,
}: FeedbackFormProps) {
  const messages = useFeedbackMessages();
  const titleId = useId();
  const bodyId = useId();
  const kindId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    event.preventDefault();
    const values = new FormData(form);
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({
        title: String(values.get("title") ?? "").trim(),
        body: String(values.get("body") ?? "").trim(),
        kind: String(values.get("kind")) as FeedbackKind,
      });
      form.reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : messages.formError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-busy={busy}
      className={cn("grid gap-3", className)}
    >
      <label htmlFor={titleId} className="text-sm font-medium">
        {messages.formTitleLabel}
      </label>
      <input
        id={titleId}
        name="title"
        required
        maxLength={160}
        className="rounded-md border px-3 py-2 text-sm"
        style={{
          borderColor: "var(--userr-border)",
          background: "var(--userr-surface)",
          color: "var(--userr-text)",
        }}
      />
      {similar.length > 0 && (
        <div
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: "var(--userr-border)" }}
        >
          <p className="mb-1 font-medium">{messages.similarHeading}</p>
          <ul className="list-disc pl-5">
            {similar.map((s) => (
              <li key={s.id}>
                {s.title} · {s.voteCount}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label htmlFor={bodyId} className="text-sm font-medium">
        {messages.formBodyLabel}
      </label>
      <textarea
        id={bodyId}
        name="body"
        rows={5}
        maxLength={10_000}
        className="rounded-md border px-3 py-2 text-sm"
        style={{
          borderColor: "var(--userr-border)",
          background: "var(--userr-surface)",
          color: "var(--userr-text)",
        }}
      />
      <label htmlFor={kindId} className="text-sm font-medium">
        {messages.formKindLabel}{" "}
        <select
          id={kindId}
          name="kind"
          className="rounded-md border px-2 py-1 text-sm"
          style={{ borderColor: "var(--userr-border)" }}
        >
          {kinds.map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        type="submit"
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--userr-accent)" }}
      >
        {busy ? messages.formSubmitting : messages.formSubmit}
      </button>
    </form>
  );
}
