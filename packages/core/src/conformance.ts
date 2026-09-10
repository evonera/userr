import { strict as assert } from "node:assert";

import { createMergePlan } from "./rules.js";
import type {
  FeedbackItem,
  FeedbackRepository,
  ItemState,
} from "./types.js";

/**
 * Shared domain conformance suite. Every backend adapter (Convex, Neon, ...)
 * must pass this exact scenario before it may claim parity. It exercises only
 * the `FeedbackRepository` contract — no backend-specific APIs — so the same
 * function runs in `node --test`, vitest, or any other runner.
 *
 * The scenario uses fixed actor IDs and asserts storage-level guarantees:
 * vote uniqueness, atomic merge with vote transfer, canonical readability,
 * cursor pagination, and a complete event audit trail.
 */
export async function runConformanceSuite(
  repo: FeedbackRepository,
): Promise<void> {
  const states: readonly ItemState[] = [
    "inbox",
    "open",
    "planned",
    "in_progress",
    "shipped",
    "closed",
  ];

  // 1. Board creation echoes its inputs.
  const board = await repo.createBoard({
    slug: "feedback",
    name: "Feedback",
    visibility: "public",
    allowedKinds: ["idea", "bug", "feedback"],
    statusOrder: states,
  });
  assert.equal(board.slug, "feedback");
  assert.deepEqual([...board.allowedKinds], ["idea", "bug", "feedback"]);

  // 2. Item creation starts with zero engagement and inbox state.
  const source = await repo.createItem({
    boardId: board.id,
    title: "Dark Mode",
    body: "Please add dark mode.",
    kind: "idea",
    authorId: "alice",
  });
  assert.equal(source.voteCount, 0);
  assert.equal(source.commentCount, 0);
  assert.equal(source.state, "inbox");
  assert.equal(source.authorId, "alice");

  const target = await repo.createItem({
    boardId: board.id,
    title: "Dark Theme Support",
    body: "A dark theme would help at night.",
    kind: "idea",
    authorId: "bob",
  });

  // 3. Votes are unique per (item, actor); repeats are no-ops.
  const first = await repo.castVote({ itemId: source.id, actorId: "carol" });
  assert.equal(first.added, true);
  assert.equal(first.voteCount, 1);
  const repeat = await repo.castVote({ itemId: source.id, actorId: "carol" });
  assert.equal(repeat.added, false);
  assert.equal(repeat.voteCount, 1);

  // 4. Unvote removes exactly once.
  const unvoted = await repo.uncastVote({
    itemId: source.id,
    actorId: "carol",
  });
  assert.equal(unvoted.removed, true);
  assert.equal(unvoted.voteCount, 0);
  const unvotedAgain = await repo.uncastVote({
    itemId: source.id,
    actorId: "carol",
  });
  assert.equal(unvotedAgain.removed, false);
  assert.equal(unvotedAgain.voteCount, 0);

  // 5. Merge transfers non-duplicate votes and keeps the source readable.
  // carol votes on both sides so the transfer must dedupe to one vote.
  await repo.castVote({ itemId: source.id, actorId: "carol" });
  await repo.castVote({ itemId: source.id, actorId: "dave" });
  await repo.castVote({ itemId: target.id, actorId: "carol" });
  const freshSource = await repo.findItem(source.id);
  const freshTarget = await repo.findItem(target.id);
  assert.ok(freshSource && freshTarget);
  const plan = createMergePlan({
    source: freshSource,
    target: freshTarget,
    actorId: "moderator",
    mergedAt: Date.now(),
    reason: "duplicate",
  });
  await repo.merge(plan);

  const mergedSource = await repo.findItem(source.id);
  assert.ok(mergedSource, "merged source must remain readable");
  assert.equal(mergedSource.state, "merged");
  assert.equal(mergedSource.mergedInto, target.id);

  const mergedTarget = await repo.findItem(target.id);
  assert.ok(mergedTarget);
  // carol (both sides) + dave (source only) = 2 votes, not 3.
  assert.equal(mergedTarget.voteCount, 2);

  const canonical = await repo.findCanonicalItem(source.id);
  assert.ok(canonical);
  assert.equal(canonical.id, target.id);

  // 6. Cursor pagination walks every item exactly once.
  const titles = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
  for (const title of titles) {
    await repo.createItem({
      boardId: board.id,
      title,
      body: `${title} body.`,
      kind: "feedback",
      authorId: "alice",
    });
  }
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const page = await repo.listItems({ boardId: board.id, limit: 2, cursor });
    for (const item of page.items) {
      assert.ok(!seen.has(item.id), `item ${item.id} listed twice`);
      seen.add(item.id);
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  // 2 merged-side items + 5 new ones = 7 total.
  assert.equal(seen.size, 7);

  // 7. State filter narrows the listing.
  const inbox = await repo.listItems({
    boardId: board.id,
    limit: 20,
    state: "inbox",
  });
  assert.ok(inbox.items.length > 0);
  assert.ok(inbox.items.every((item: FeedbackItem) => item.state === "inbox"));

  // 8. The audit trail records the lifecycle.
  const events = await repo.listEvents({ itemId: source.id });
  const types = events.map((event) => event.type);
  assert.ok(types.includes("created"), "missing created event");
  assert.ok(types.includes("vote_added"), "missing vote_added event");
  assert.ok(types.includes("merged"), "missing merged event");

  // 9. Status transitions persist and audit from/to; repeats are no-ops.
  await repo.setState({ itemId: target.id, state: "planned", actorId: "moderator" });
  const planned = await repo.findItem(target.id);
  assert.equal(planned?.state, "planned");
  const afterStates = await repo.listEvents({ itemId: target.id });
  const change = afterStates.find((event) => event.type === "state_changed");
  assert.deepEqual(change?.payload, { from: "inbox", to: "planned" });
  const eventCount = afterStates.length;
  await repo.setState({ itemId: target.id, state: "planned", actorId: "moderator" });
  assert.equal((await repo.listEvents({ itemId: target.id })).length, eventCount);

  // 10. States outside the contract are rejected, never persisted.
  await assert.rejects(
    repo.setState({
      itemId: target.id,
      state: "nonsense" as ItemState,
      actorId: "moderator",
    }),
  );
  assert.equal((await repo.findItem(target.id))?.state, "planned");
}
