import Markdown from "react-markdown";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { ChangelogEntryView } from "./views.js";

export interface ChangelogListProps {
  entries: readonly ChangelogEntryView[];
  onOpen?: (id: string) => void;
  className?: string;
}

export function ChangelogList({ entries, onOpen, className }: ChangelogListProps) {
  const messages = useFeedbackMessages();
  if (entries.length === 0) {
    return (
      <p
        className={cn(
          "rounded-md border p-6 text-center text-sm",
          className,
        )}
        style={{
          borderColor: "var(--userr-border)",
          color: "var(--userr-muted)",
        }}
      >
        {messages.changelogEmpty}
      </p>
    );
  }
  return (
    <div className={cn("grid gap-4", className)}>
      {entries.map((entry) => (
        <article
          key={entry.id}
          className="rounded-[var(--userr-radius)] border p-4"
          style={{
            borderColor: "var(--userr-border)",
            background: "var(--userr-surface)",
            color: "var(--userr-text)",
          }}
        >
          <button
            onClick={onOpen ? () => onOpen(entry.id) : undefined}
            className="text-left text-base font-bold"
          >
            {entry.title}
          </button>
          <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
            {entry.version && <span>v{entry.version} · </span>}
            {messages.publishedOn(
              new Date(
                entry.publishedAt ?? entry.createdAt,
              ).toLocaleDateString(),
            )}
          </p>
          <div className="prose prose-sm mt-2 line-clamp-3 max-w-none">
            <Markdown>{entry.body}</Markdown>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ChangelogEntry({
  entry,
  className,
}: {
  entry: ChangelogEntryView;
  className?: string;
}) {
  const messages = useFeedbackMessages();
  return (
    <article className={cn("grid gap-2", className)}>
      <h1 className="text-2xl font-bold">{entry.title}</h1>
      <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
        {entry.version && <span>v{entry.version} · </span>}
        {messages.publishedOn(
          new Date(entry.publishedAt ?? entry.createdAt).toLocaleDateString(),
        )}
      </p>
      <div className="prose max-w-none">
        <Markdown>{entry.body}</Markdown>
      </div>
    </article>
  );
}
