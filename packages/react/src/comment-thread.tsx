import { useState, type FormEvent } from "react";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { CommentView } from "./views.js";

export interface CommentThreadProps {
  comments: readonly CommentView[];
  hasMore?: boolean;
  onReply?: (parentId: string | undefined, body: string) => Promise<void> | void;
  onLoadMore?: () => void;
  className?: string;
}

function ReplyForm({
  parentId,
  onReply,
}: {
  parentId: string | undefined;
  onReply: NonNullable<CommentThreadProps["onReply"]>;
}) {
  const messages = useFeedbackMessages();
  const [open, setOpen] = useState(!parentId);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium underline"
      >
        {messages.reply}
      </button>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    event.preventDefault();
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    setBusy(true);
    try {
      await onReply(parentId, body);
      form.reset();
      if (parentId) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <textarea
        name="body"
        required
        rows={parentId ? 2 : 3}
        maxLength={5_000}
        placeholder={messages.replyPlaceholder("")}
        aria-label={messages.reply}
        className="rounded-md border px-3 py-2 text-sm"
        style={{
          borderColor: "var(--userr-border)",
          background: "var(--userr-surface)",
          color: "var(--userr-text)",
        }}
      />
      <button
        disabled={busy}
        className="justify-self-start rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--userr-accent)" }}
      >
        {messages.reply}
      </button>
    </form>
  );
}

export function CommentThread({
  comments,
  hasMore,
  onReply,
  onLoadMore,
  className,
}: CommentThreadProps) {
  const messages = useFeedbackMessages();
  const roots = comments.filter((c) => !c.parentId);
  const replies = new Map<string, CommentView[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const list = replies.get(comment.parentId) ?? [];
    list.push(comment);
    replies.set(comment.parentId, list);
  }

  return (
    <div className={cn("grid gap-4", className)}>
      <div className="grid gap-4">
        {roots.map((root) => (
          <div key={root.id} className="grid gap-2">
            <div
              className="rounded-md border p-3 text-sm"
              style={{ borderColor: "var(--userr-border)" }}
            >
              <p
                className="mb-1 text-xs"
                style={{ color: "var(--userr-muted)" }}
              >
                {root.actorId} ·{" "}
                {new Date(root.createdAt).toLocaleDateString()}
              </p>
              <p>{root.body ?? messages.commentDeleted}</p>
            </div>
            {(replies.get(root.id) ?? []).map((reply) => (
              <div
                key={reply.id}
                className="ml-6 rounded-md border p-3 text-sm"
                style={{ borderColor: "var(--userr-border)" }}
              >
                <p
                  className="mb-1 text-xs"
                  style={{ color: "var(--userr-muted)" }}
                >
                  {reply.actorId} ·{" "}
                  {new Date(reply.createdAt).toLocaleDateString()}
                </p>
                <p>{reply.body ?? messages.commentDeleted}</p>
              </div>
            ))}
            {onReply && root.body !== null && (
              <div className="ml-6">
                <ReplyForm parentId={root.id} onReply={onReply} />
              </div>
            )}
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={onLoadMore}
          className="justify-self-start text-xs font-medium underline"
        >
          {messages.boardLoadMore}
        </button>
      )}
      {onReply && (
        <div className="border-t pt-4" style={{ borderColor: "var(--userr-border)" }}>
          <ReplyForm parentId={undefined} onReply={onReply} />
        </div>
      )}
    </div>
  );
}
