import type { FeedbackItem, ItemState, MergePlan, Role, StatusTransition } from "./types.js";

export class FeedbackRuleError extends Error {
  constructor(message: string, readonly code: "INVALID_TRANSITION" | "MERGE_CONFLICT" | "PERMISSION_DENIED") {
    super(message);
    this.name = "FeedbackRuleError";
  }
}

/** Every state the store may persist. Adapters and route layers must reject
 *  anything outside this list — never let an unconstrained text column decide
 *  what a state is. `merged` is set only by the merge operation, never by a
 *  direct transition. */
export const ITEM_STATES: readonly ItemState[] = [
  "inbox",
  "open",
  "planned",
  "in_progress",
  "shipped",
  "closed",
  "merged",
];

export function assertTransition(input: {
  current: ItemState;
  next: ItemState;
  role: Role | null;
  transitions: readonly StatusTransition[];
}): void {
  const rule = input.transitions.find((candidate) => candidate.from === input.current && candidate.to === input.next);
  if (!rule) throw new FeedbackRuleError(`Cannot move ${input.current} to ${input.next}.`, "INVALID_TRANSITION");
  if (!input.role || !rule.roles.includes(input.role)) {
    throw new FeedbackRuleError("The actor cannot perform this status transition.", "PERMISSION_DENIED");
  }
}

export function createMergePlan(input: {
  source: FeedbackItem;
  target: FeedbackItem;
  actorId: string;
  mergedAt: number;
  reason?: string;
}): MergePlan {
  const { source, target } = input;
  if (source.id === target.id) throw new FeedbackRuleError("A request cannot be merged into itself.", "MERGE_CONFLICT");
  if (source.boardId !== target.boardId) throw new FeedbackRuleError("Requests must belong to the same board.", "MERGE_CONFLICT");
  if (source.mergedInto) throw new FeedbackRuleError("The source request is already merged.", "MERGE_CONFLICT");
  if (target.mergedInto) throw new FeedbackRuleError("A canonical target cannot itself be merged.", "MERGE_CONFLICT");
  if (source.state === "shipped" || target.state === "merged") throw new FeedbackRuleError("This merge would lose a completed or canonical record.", "MERGE_CONFLICT");
  return { sourceId: source.id, targetId: target.id, actorId: input.actorId, mergedAt: input.mergedAt, reason: input.reason };
}

export function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ");
}

export function lexicalSimilarity(left: string, right: string): number {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / union;
}
