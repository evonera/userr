import { useId, useState, type FormEvent } from "react";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView } from "./views.js";

export interface ChangelogPublisherProps {
  shippedItems: readonly BoardItemView[];
  subscriberCount?: number;
  onPublish?: (input: {
    title: string;
    body: string;
    version?: string;
    linkedItemIds: string[];
  }) => Promise<void> | void;
  className?: string;
}

/** Changelog publisher: entry form with shipped-item linking and a
 *  subscriber fan-out preview. Delivery itself runs through the host's email
 *  hook (see the CLI Resend scaffold) — this component only collects intent. */
export function ChangelogPublisher({
  shippedItems,
  subscriberCount = 0,
  onPublish,
  className,
}: ChangelogPublisherProps) {
  const messages = useFeedbackMessages();
  const titleId = useId();
  const bodyId = useId();
  const versionId = useId();
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function toggleLinked(id: string) {
    setLinked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await onPublish?.({
        title: String(values.get("title") ?? "").trim(),
        body: String(values.get("body") ?? "").trim(),
        version: String(values.get("version") ?? "").trim() || undefined,
        linkedItemIds: [...linked],
      });
      event.currentTarget.reset();
      setLinked(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.formError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={cn("grid gap-3", className)}>
      <h2 className="text-lg font-bold">{messages.publishChangelog}</h2>
      <label htmlFor={titleId} className="text-sm font-medium">
        {messages.changelogTitleLabel}
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
      <label htmlFor={bodyId} className="text-sm font-medium">
        {messages.changelogBodyLabel}
      </label>
      <textarea
        id={bodyId}
        name="body"
        required
        rows={6}
        className="rounded-md border px-3 py-2 text-sm"
        style={{
          borderColor: "var(--userr-border)",
          background: "var(--userr-surface)",
          color: "var(--userr-text)",
        }}
      />
      <label htmlFor={versionId} className="text-sm font-medium">
        {messages.changelogVersionLabel}
      </label>
      <input
        id={versionId}
        name="version"
        maxLength={32}
        placeholder="2.3.0"
        className="rounded-md border px-3 py-2 text-sm"
        style={{
          borderColor: "var(--userr-border)",
          background: "var(--userr-surface)",
          color: "var(--userr-text)",
        }}
      />
      {shippedItems.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">
            {messages.linkShippedItems}
          </legend>
          <div className="mt-1 grid gap-1">
            {shippedItems.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={linked.has(item.id)}
                  onChange={() => toggleLinked(item.id)}
                />
                {item.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
        {messages.notifySubscribers(subscriberCount)}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        type="submit"
        className="justify-self-start rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--userr-accent)" }}
      >
        {busy ? messages.formSubmitting : messages.publishChangelog}
      </button>
    </form>
  );
}
