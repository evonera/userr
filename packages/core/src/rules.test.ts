import assert from "node:assert/strict";
import test from "node:test";
import { assertTransition, createMergePlan, lexicalSimilarity } from "./rules.js";
import type { FeedbackItem } from "./types.js";

const item = (id: string): FeedbackItem => ({ id, boardId: "board", publicId: id, slug: id, title: "Dark mode", body: "", kind: "idea", state: "open", authorId: "a", createdAt: 1, updatedAt: 1, voteCount: 0, commentCount: 0, labels: [] });

test("only configured roles can transition an item", () => {
  assert.doesNotThrow(() => assertTransition({ current: "open", next: "planned", role: "moderator", transitions: [{ from: "open", to: "planned", roles: ["moderator", "admin"] }] }));
  assert.throws(() => assertTransition({ current: "open", next: "planned", role: "member", transitions: [{ from: "open", to: "planned", roles: ["moderator"] }] }));
});

test("merge plans preserve a same-board canonical relationship", () => {
  assert.deepEqual(createMergePlan({ source: item("one"), target: item("two"), actorId: "admin", mergedAt: 2 }), { sourceId: "one", targetId: "two", actorId: "admin", mergedAt: 2, reason: undefined });
  assert.throws(() => createMergePlan({ source: item("one"), target: item("one"), actorId: "admin", mergedAt: 2 }));
});

test("lexical suggestions do not require an AI provider", () => {
  assert.ok(lexicalSimilarity("Dark mode support", "Support dark mode") > 0.5);
  assert.equal(lexicalSimilarity("Dark mode", "CSV export"), 0);
});
