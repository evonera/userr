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

  // 5b. Merging away a shipped record is rejected on every adapter (it would
  // lose a completed canonical entry). Uses fresh items so later steps keep
  // their fixtures. The plan is built literally: core's createMergePlan would
  // (correctly) reject first, but this step must prove the ADAPTER refuses.
  const shippedSource = await repo.createItem({
    boardId: board.id,
    title: "Shipped source",
    body: "Already shipped.",
    kind: "idea",
    authorId: "alice",
  });
  await repo.setState({
    itemId: shippedSource.id,
    state: "shipped",
    actorId: "moderator",
  });
  const spare = await repo.createItem({
    boardId: board.id,
    title: "Spare",
    body: "Spare body.",
    kind: "idea",
    authorId: "alice",
  });
  await assert.rejects(
    repo.merge({
      sourceId: shippedSource.id,
      targetId: spare.id,
      actorId: "moderator",
      mergedAt: Date.now(),
    }),
  );

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
  // 2 merged-side items + 2 shipped-check items + 5 new ones = 9 total.
  assert.equal(seen.size, 9);

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

  // 10. States outside the contract are rejected, never persisted — and
  // `merged` is merge-operation-only (it must always come with mergedInto).
  await assert.rejects(
    repo.setState({
      itemId: target.id,
      state: "nonsense" as ItemState,
      actorId: "moderator",
    }),
  );
  await assert.rejects(
    repo.setState({
      itemId: target.id,
      state: "merged",
      actorId: "moderator",
    }),
  );
  assert.equal((await repo.findItem(target.id))?.state, "planned");

  // 11. Changelog entries publish with linked items and paginate — but
  // dangling and cross-board links are rejected on every adapter.
  const entry = await repo.publishChangelogEntry({
    boardId: board.id,
    title: "Dark theme ships",
    body: "The most requested theme is here.",
    version: "2.3.0",
    linkedItemIds: [target.id],
    publishedAt: Date.now(),
  });
  assert.equal(entry.boardId, board.id);
  assert.deepEqual([...entry.linkedItemIds], [target.id]);
  const changelog = await repo.listChangelog({ boardId: board.id, limit: 10 });
  assert.ok(changelog.items.some((e) => e.id === entry.id));
  await assert.rejects(
    repo.publishChangelogEntry({
      boardId: board.id,
      title: "Bad links",
      body: "Dangling.",
      linkedItemIds: ["item_missing"],
    }),
  );
  const otherBoard = await repo.createBoard({
    slug: "other",
    name: "Other",
    visibility: "public",
    allowedKinds: ["idea"],
    statusOrder: ["inbox"],
  });
  const foreign = await repo.createItem({
    boardId: otherBoard.id,
    title: "Foreign",
    body: "Elsewhere.",
    kind: "idea",
    authorId: "alice",
  });
  await assert.rejects(
    repo.publishChangelogEntry({
      boardId: board.id,
      title: "Bad links",
      body: "Cross-board.",
      linkedItemIds: [foreign.id],
    }),
  );

  // 12. Roadmap lanes save (create + update by id) and list in order — and
  // states outside the contract are rejected on every adapter.
  await repo.saveLane({
    boardId: board.id,
    name: "Now",
    states: ["in_progress"],
    order: 1,
  });
  const lane = await repo.saveLane({
    boardId: board.id,
    name: "Next",
    states: ["planned"],
    order: 0,
  });
  const renamed = await repo.saveLane({ ...lane, name: "Up next" });
  assert.equal(renamed.name, "Up next");
  await assert.rejects(
    repo.saveLane({
      boardId: board.id,
      name: "Bogus",
      states: ["bogus" as ItemState],
      order: 2,
    }),
  );
  const lanes = await repo.listLanes({ boardId: board.id });
  assert.deepEqual(
    lanes.map((l) => l.name),
    ["Up next", "Now"],
  );

  // 13. Webhook lifecycle: secret returned once, masked afterwards.
  const { webhook, secret } = await repo.createWebhook({
    boardId: board.id,
    url: "https://example.com/hook",
    events: ["post.created", "post.status_changed"],
  });
  assert.equal(secret.length, 64);
  assert.ok(webhook.secretPreview.endsWith(secret.slice(-4)));
  assert.ok(
    !("secret" in webhook),
    "full secret must never appear on the stored object",
  );
  await repo.updateWebhook({ id: webhook.id, active: false });
  const { secret: rotated } = await repo.rotateWebhookSecret({
    id: webhook.id,
  });
  assert.notEqual(rotated, secret);
  await repo.updateWebhook({ id: webhook.id, active: true });
  assert.equal((await repo.listWebhooks({ boardId: board.id })).length, 1);
  await repo.deleteWebhook({ id: webhook.id });
  assert.equal((await repo.listWebhooks({ boardId: board.id })).length, 0);

  // 14. Deliveries: item creation enqueues post.created; vote milestones fan
  // out; outcomes drive retries and eventual failing state.
  const { webhook: live } = await repo.createWebhook({
    boardId: board.id,
    url: "https://example.com/hook",
    events: ["post.created", "vote.milestone", "post.status_changed"],
  });
  const announced = await repo.createItem({
    boardId: board.id,
    title: "Announced",
    body: "Watch for deliveries.",
    kind: "idea",
    authorId: "alice",
  });
  const created = await repo.listDeliveries({ webhookId: live.id });
  assert.ok(
    created.some(
      (d) => d.event === "post.created" && d.status === "pending",
    ),
    "post.created must enqueue a pending delivery",
  );
  const createdDelivery = created.find((d) => d.event === "post.created")!;
  const done = await repo.recordDeliveryOutcome({
    deliveryId: createdDelivery.id,
    ok: true,
  });
  assert.equal(done.status, "delivered");

  for (let i = 0; i < 10; i++) {
    await repo.castVote({ itemId: announced.id, actorId: `voter-${i}` });
  }
  const milestones = await repo.listDeliveries({ webhookId: live.id });
  assert.ok(
    milestones.some(
      (d) => d.event === "vote.milestone" && d.status === "pending",
    ),
    "reaching 10 votes must enqueue a milestone delivery",
  );

  const failing = milestones.find((d) => d.event === "vote.milestone")!;
  let last = failing;
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await repo.recordDeliveryOutcome({
      deliveryId: failing.id,
      ok: false,
      error: "connection refused",
    });
  }
  assert.equal(last.status, "failed");
  assert.ok(
    (last.attempts ?? 0) >= 6,
    "exhausted schedule stops retrying",
  );
}
