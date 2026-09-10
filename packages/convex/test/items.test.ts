import { describe, expect, test } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { createBoard, createItem, ghostId, setup } from "./setup.js";

describe("boards", () => {
  test("creates and fetches boards by id and slug", async () => {
    const t = setup();
    const boardId = await createBoard(t, { slug: "feedback" });
    const byId = await t.query(api.boards.get, { boardId });
    expect(byId?.slug).toBe("feedback");
    expect(byId?.visibility).toBe("public");
    expect(byId?.allowedKinds).toContain("idea");
    const bySlug = await t.query(api.boards.getBySlug, { slug: "feedback" });
    expect(bySlug?._id).toBe(boardId);
  });

  test("rejects duplicate slugs", async () => {
    const t = setup();
    await createBoard(t, { slug: "feedback" });
    await expect(createBoard(t, { slug: "feedback" })).rejects.toThrow();
  });

  test("returns null for unknown boards", async () => {
    const t = setup();
    const bySlug = await t.query(api.boards.getBySlug, { slug: "nope" });
    expect(bySlug).toBeNull();
  });
});

describe("items.create", () => {
  test("creates inbox items with derived slug and event", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId, { title: "Dark Mode" });
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item.state).toBe("inbox");
    expect(got?.item.slug).toContain("dark-mode");
    expect(got?.item.normalizedTitle).toBe("dark mode");
    expect(got?.viewerHasVoted).toBe(false);
    const events = await t.query(api.items.events, {
      itemId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page.map((e) => e.type)).toContain("created");
  });

  test("rejects disallowed kinds and bad titles", async () => {
    const t = setup();
    const boardId = await createBoard(t, { allowedKinds: ["bug"] });
    await expect(createItem(t, boardId, { kind: "idea" })).rejects.toThrow();
    await expect(createItem(t, boardId, { kind: "bug", title: "  " })).rejects.toThrow();
    await expect(
      createItem(t, boardId, { kind: "bug", title: "x".repeat(161) }),
    ).rejects.toThrow();
  });

  test("rejects unknown boards", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    await expect(
      createItem(t, ghostId(boardId), { title: "Ghost" }),
    ).rejects.toThrow("Board not found.");
  });
});

describe("items.list", () => {
  test("paginates newest-first through every item", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await createItem(t, boardId, { title: `Item ${i}` }));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result = await t.query(api.items.list, {
        boardId,
        paginationOpts: { numItems: 2, cursor },
      });
      seen.push(...result.page.map((item) => item._id as string));
      pages += 1;
      if (result.isDone) break;
      cursor = result.continueCursor;
      if (pages > 10) throw new Error("pagination did not terminate");
    }
    expect(seen.sort()).toEqual(ids.sort());
  });

  test("filters by state", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.items.setState, {
      itemId,
      state: "planned",
      actorId: "moderator",
    });
    const planned = await t.query(api.items.list, {
      boardId,
      state: "planned",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(planned.page.map((i) => i._id)).toEqual([itemId]);
    const inbox = await t.query(api.items.list, {
      boardId,
      state: "inbox",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(inbox.page).toEqual([]);
  });
});

describe("items.listTop", () => {
  test("orders by vote count", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const low = await createItem(t, boardId, { title: "Low" });
    const high = await createItem(t, boardId, { title: "High" });
    await t.mutation(api.items.vote, { itemId: low, actorId: "a" });
    await t.mutation(api.items.vote, { itemId: high, actorId: "a" });
    await t.mutation(api.items.vote, { itemId: high, actorId: "b" });
    const top = await t.query(api.items.listTop, { boardId });
    expect(top.map((i) => i._id)).toEqual([high, low]);
  });
});

describe("items.get", () => {
  test("reports viewer vote and subscription state", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const before = await t.query(api.items.get, {
      itemId,
      viewerActorId: "carol",
    });
    expect(before?.viewerHasVoted).toBe(false);
    expect(before?.viewerIsSubscribed).toBe(false);
    await t.mutation(api.items.vote, { itemId, actorId: "carol" });
    await t.mutation(api.subscriptions.subscribe, {
      itemId,
      actorId: "carol",
    });
    const after = await t.query(api.items.get, {
      itemId,
      viewerActorId: "carol",
    });
    expect(after?.viewerHasVoted).toBe(true);
    expect(after?.viewerIsSubscribed).toBe(true);
  });

  test("returns null for unknown items", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const got = await t.query(api.items.get, {
      itemId: ghostId(itemId) as never,
    });
    expect(got).toBeNull();
  });
});

describe("items.vote / unvote", () => {
  test("votes are idempotent and unvotes remove exactly once", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const first = await t.mutation(api.items.vote, {
      itemId,
      actorId: "carol",
    });
    expect(first).toEqual({ added: true, voteCount: 1 });
    const repeat = await t.mutation(api.items.vote, {
      itemId,
      actorId: "carol",
    });
    expect(repeat).toEqual({ added: false, voteCount: 1 });
    const removed = await t.mutation(api.items.unvote, {
      itemId,
      actorId: "carol",
    });
    expect(removed).toEqual({ removed: true, voteCount: 0 });
    const again = await t.mutation(api.items.unvote, {
      itemId,
      actorId: "carol",
    });
    expect(again).toEqual({ removed: false, voteCount: 0 });
  });

  test("rejects votes on merged items", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const source = await createItem(t, boardId, { title: "Source" });
    const target = await createItem(t, boardId, { title: "Target" });
    await t.mutation(api.items.merge, {
      sourceId: source,
      targetId: target,
      actorId: "moderator",
    });
    await expect(
      t.mutation(api.items.vote, { itemId: source, actorId: "carol" }),
    ).rejects.toThrow();
  });
});

describe("items.setState", () => {
  test("transitions state and audits from/to", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.items.setState, {
      itemId,
      state: "planned",
      actorId: "moderator",
    });
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item.state).toBe("planned");
    const events = await t.query(api.items.events, {
      itemId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const change = events.page.find((e) => e.type === "state_changed");
    expect(change?.payload).toEqual({ from: "inbox", to: "planned" });
  });

  test("same-state transitions are no-ops", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.items.setState, {
      itemId,
      state: "inbox",
      actorId: "moderator",
    });
    const events = await t.query(api.items.events, {
      itemId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page.filter((e) => e.type === "state_changed")).toEqual([]);
  });

  test("rejects direct transitions to merged", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await expect(
      t.mutation(api.items.setState, {
        itemId,
        state: "merged",
        actorId: "moderator",
      }),
    ).rejects.toThrow();
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item.state).toBe("inbox");
    expect(got?.item.mergedInto).toBeUndefined();
  });
});

describe("items.merge", () => {
  test("transfers non-duplicate votes and subscriptions, keeps source readable", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const source = await createItem(t, boardId, { title: "Source" });
    const target = await createItem(t, boardId, { title: "Target" });
    await t.mutation(api.items.vote, { itemId: source, actorId: "carol" });
    await t.mutation(api.items.vote, { itemId: source, actorId: "dave" });
    await t.mutation(api.items.vote, { itemId: target, actorId: "carol" });
    await t.mutation(api.subscriptions.subscribe, {
      itemId: source,
      actorId: "dave",
    });
    await t.mutation(api.items.merge, {
      sourceId: source,
      targetId: target,
      actorId: "moderator",
      reason: "duplicate",
    });
    const mergedSource = await t.query(api.items.get, { itemId: source });
    expect(mergedSource?.item.state).toBe("merged");
    expect(mergedSource?.item.mergedInto).toBe(target);
    const mergedTarget = await t.query(api.items.get, { itemId: target });
    expect(mergedTarget?.item.voteCount).toBe(2);
    const subs = await t.query(api.subscriptions.subscribers, {
      itemId: target,
    });
    expect(subs.map((s) => s.actorId)).toContain("dave");
    const events = await t.query(api.items.events, {
      itemId: source,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const merged = events.page.find((e) => e.type === "merged");
    expect(merged?.payload).toMatchObject({ targetId: target });
  });

  test("rejects self, cross-board, and chained merges", async () => {    const t = setup();
    const boardA = await createBoard(t);
    const boardB = await createBoard(t);
    const a1 = await createItem(t, boardA, { title: "A1" });
    const a2 = await createItem(t, boardA, { title: "A2" });
    const b1 = await createItem(t, boardB, { title: "B1" });
    await expect(
      t.mutation(api.items.merge, {
        sourceId: a1,
        targetId: a1,
        actorId: "moderator",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.items.merge, {
        sourceId: a1,
        targetId: b1,
        actorId: "moderator",
      }),
    ).rejects.toThrow();
    await t.mutation(api.items.merge, {
      sourceId: a1,
      targetId: a2,
      actorId: "moderator",
    });
    await expect(
      t.mutation(api.items.merge, {
        sourceId: a1,
        targetId: a2,
        actorId: "moderator",
      }),
    ).rejects.toThrow();
  });

  test("rejects merging away a shipped source", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const shipped = await createItem(t, boardId, { title: "Shipped" });
    const target = await createItem(t, boardId, { title: "Target" });
    await t.mutation(api.items.setState, {
      itemId: shipped,
      state: "shipped",
      actorId: "moderator",
    });
    await expect(
      t.mutation(api.items.merge, {
        sourceId: shipped,
        targetId: target,
        actorId: "moderator",
      }),
    ).rejects.toThrow(/completed or canonical/);
  });
});

describe("items.findSimilar", () => {
  test("finds exact and lexical matches without AI", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const original = await createItem(t, boardId, {
      title: "Dark mode support",
      body: "A dark theme for night use.",
    });
    const result = await t.query(api.items.findSimilar, {
      boardId,
      title: "Dark Mode Support",
    });
    expect(result.exact).toBe(original);
    const related = await t.query(api.items.findSimilar, {
      boardId,
      title: "dark theme at night",
    });
    expect(related.similar.map((s) => s.id)).toContain(original);
  });

  test("survives multiple live items with identical titles", async () => {
    // Regression: normalized titles are non-unique, so the exact lookup must
    // not use .unique() — two live duplicates used to throw.
    const t = setup();
    const boardId = await createBoard(t);
    const first = await createItem(t, boardId, { title: "Dark mode" });
    const second = await createItem(t, boardId, { title: "dark  MODE" });
    const result = await t.query(api.items.findSimilar, {
      boardId,
      title: "Dark Mode",
    });
    expect([first, second]).toContain(result.exact);
  });

  test("returns empty for blank titles", async () => {    const t = setup();
    const boardId = await createBoard(t);
    const result = await t.query(api.items.findSimilar, {
      boardId,
      title: "   ",
    });
    expect(result).toEqual({ exact: null, similar: [] });
  });
});

describe("items.recordEvent", () => {
  test("appends host-defined audit events", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.items.recordEvent, {
      itemId,
      type: "slack_notified",
      actorId: "moderator",
      payload: { channel: "#feedback" },
    });
    const events = await t.query(api.items.events, {
      itemId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const custom = events.page.find((e) => e.type === "slack_notified");
    expect(custom?.payload).toEqual({ channel: "#feedback" });
  });
});
