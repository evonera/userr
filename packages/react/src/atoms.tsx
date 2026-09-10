import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";

export interface VoteButtonProps {
  count: number;
  voted?: boolean;
  title: string;
  onToggle?: () => void;
  className?: string;
}

export function VoteButton({
  count,
  voted,
  title,
  onToggle,
  className,
}: VoteButtonProps) {
  const messages = useFeedbackMessages();
  return (
    <button
      type="button"
      aria-pressed={voted}
      onClick={onToggle}
      aria-label={messages.voteFor(title)}
      className={cn(
        "inline-flex min-w-12 flex-col items-center rounded-md border px-2 py-1 text-sm font-semibold",
        voted
          ? "border-transparent text-white"
          : "text-[var(--userr-text)]",
        className,
      )}
      style={
        voted
          ? { background: "var(--userr-accent)" }
          : {
              background: "var(--userr-surface)",
              borderColor: "var(--userr-border)",
            }
      }
    >
      <span aria-hidden>▲</span>
      <span>{count}</span>
    </button>
  );
}

const STATE_STYLES: Record<string, string> = {
  inbox: "bg-zinc-100 text-zinc-700",
  open: "bg-sky-100 text-sky-800",
  planned: "bg-violet-100 text-violet-800",
  in_progress: "bg-amber-100 text-amber-800",
  shipped: "bg-emerald-100 text-emerald-800",
  closed: "bg-zinc-200 text-zinc-500",
  merged: "bg-zinc-100 text-zinc-500",
};

export function StatusBadge({
  state,
  className,
}: {
  state: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATE_STYLES[state] ?? "bg-zinc-100 text-zinc-700",
        className,
      )}
    >
      {state.replace(/_/g, " ")}
    </span>
  );
}
