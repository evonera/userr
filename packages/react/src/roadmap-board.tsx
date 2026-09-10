import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView, RoadmapLaneView } from "./views.js";
import { FeedbackCard } from "./feedback-card.js";

export interface RoadmapBoardProps {
  lanes: readonly RoadmapLaneView[];
  itemsByLane: Record<string, readonly BoardItemView[]>;
  votedIds?: ReadonlySet<string>;
  onVote?: (id: string) => void;
  onOpen?: (id: string) => void;
  className?: string;
}

/** Read-only public roadmap. Status changes happen in triage (Phase 4);
 *  this view only groups items under host-configured lanes. */
export function RoadmapBoard({
  lanes,
  itemsByLane,
  votedIds,
  onVote,
  onOpen,
  className,
}: RoadmapBoardProps) {
  const messages = useFeedbackMessages();
  const ordered = [...lanes].sort((a, b) => a.order - b.order);
  return (
    <div
      className={cn(
        "grid gap-4 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {ordered.map((lane) => {
        const items = itemsByLane[lane.id] ?? [];
        return (
          <section
            key={lane.id}
            aria-label={lane.name}
            className="grid content-start gap-3 rounded-[var(--userr-radius)] border p-4"
            style={{
              borderColor: "var(--userr-border)",
              background: "var(--userr-surface)",
            }}
          >
            <h2 className="text-sm font-bold tracking-wide uppercase">
              {lane.name}{" "}
              <span style={{ color: "var(--userr-muted)" }}>
                ({items.length})
              </span>
            </h2>
            {items.length === 0 ? (
              <p
                className="text-xs"
                style={{ color: "var(--userr-muted)" }}
              >
                {messages.roadmapEmptyLane}
              </p>
            ) : (
              items.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  voted={votedIds?.has(item.id)}
                  onVote={onVote ? () => onVote(item.id) : undefined}
                  onOpen={onOpen ? () => onOpen(item.id) : undefined}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
