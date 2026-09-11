"use client";

import { useEffect, useState } from "react";
import {
  closestCorners,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "./cn.js";
import { useFeedbackMessages } from "./provider.js";
import type { BoardItemView, RoadmapLaneView } from "./views.js";
import { FeedbackCard } from "./feedback-card.js";

export interface RoadmapDndProps {
  lanes: readonly RoadmapLaneView[];
  itemsByLane: Record<string, readonly BoardItemView[]>;
  onMove?: (itemId: string, toState: string, toLaneId: string) => void;
  className?: string;
}

function SortableItem({ item }: { item: BoardItemView }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <FeedbackCard item={item} />
    </div>
  );
}

function LaneColumn({
  lane,
  items,
}: {
  lane: RoadmapLaneView;
  items: readonly BoardItemView[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={lane.name}
      className={cn(
        "grid content-start gap-3 rounded-[var(--userr-radius)] border p-4",
        isOver && "ring-2",
      )}
      style={{
        borderColor: "var(--userr-border)",
        background: "var(--userr-surface)",
        ["--tw-ring-color" as string]: "var(--userr-accent)",
      }}
    >
      <h2 className="text-sm font-bold tracking-wide uppercase">
        {lane.name}{" "}
        <span style={{ color: "var(--userr-muted)" }}>({items.length})</span>
      </h2>
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {items.map((item) => (
          <SortableItem key={item.id} item={item} />
        ))}
      </SortableContext>
    </section>
  );
}

/** Triage roadmap: drag cards within and across lanes. Dropping into a lane
 *  adopts the lane's first state via onMove (the host persists with
 *  setState); in-lane reorders are display-only. */
export function RoadmapDnd({
  lanes,
  itemsByLane,
  onMove,
  className,
}: RoadmapDndProps) {
  const messages = useFeedbackMessages();
  const sensors = useSensors(useSensor(PointerSensor));
  const [grouped, setGrouped] = useState<Record<string, BoardItemView[]>>({});
  const laneKey = lanes.map((l) => l.id).join(",");
  // Fingerprint contents (not just membership): vote/title/state updates must
  // refresh rows even when lane membership is unchanged.
  const itemsKey = lanes
    .map(
      (l) =>
        `${l.id}=[${(itemsByLane[l.id] ?? [])
          .map((i) => `${i.id}:${i.voteCount}:${i.commentCount}:${i.state}:${i.title}`)
          .join(",")}]`,
    )
    .join(";");

  useEffect(() => {
    setGrouped((prev) => {
      const next: Record<string, BoardItemView[]> = {};
      for (const lane of lanes) {
        const incoming = itemsByLane[lane.id] ?? [];
        const incomingById = new Map(incoming.map((i) => [i.id, i]));
        // Keep local display order for survivors (drag reorders stick),
        // refresh their fields from the server, append newcomers, drop gone.
        const kept = (prev[lane.id] ?? [])
          .filter((item) => incomingById.has(item.id))
          .map((item) => incomingById.get(item.id)!);
        const keptIds = new Set(kept.map((i) => i.id));
        next[lane.id] = [...kept, ...incoming.filter((i) => !keptIds.has(i.id))];
      }
      return next;
    });
    // Reconcile when lanes OR item contents change; see contract above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneKey, itemsKey]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const fromLaneId = Object.keys(grouped).find((laneId) =>
      grouped[laneId].some((item) => item.id === active.id),
    );
    // `over` may be a lane column or another card; resolve to a lane.
    const toLaneId =
      grouped[over.id] !== undefined
        ? (over.id as string)
        : Object.keys(grouped).find((laneId) =>
            grouped[laneId].some((item) => item.id === over.id),
          );
    if (!fromLaneId || !toLaneId) return;
    if (fromLaneId === toLaneId) {
      const order = grouped[fromLaneId].map((item) => item.id);
      const from = order.indexOf(active.id as string);
      const to = order.indexOf(over.id as string);
      if (from === -1 || to === -1 || from === to) return;
      setGrouped((prev) => ({
        ...prev,
        [fromLaneId]: arrayMove(prev[fromLaneId], from, to).map((item) => item),
      }));
      return;
    }
    const lane = lanes.find((l) => l.id === toLaneId);
    const toState = lane?.states[0];
    const moving = grouped[fromLaneId].find((item) => item.id === active.id);
    if (!moving) return;
    setGrouped((prev) => ({
      ...prev,
      [fromLaneId]: prev[fromLaneId].filter((item) => item.id !== active.id),
      [toLaneId]: [...prev[toLaneId], moving],
    }));
    if (toState) onMove?.(moving.id, toState, toLaneId);
  }

  const ordered = [...lanes].sort((a, b) => a.order - b.order);
  return (
    <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
      {ordered.length === 0 && (
        <p className="text-xs" style={{ color: "var(--userr-muted)" }}>
          {messages.roadmapEmptyLane}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        {ordered.map((lane) => (
          <LaneColumn key={lane.id} lane={lane} items={grouped[lane.id] ?? []} />
        ))}
      </DndContext>
    </div>
  );
}
