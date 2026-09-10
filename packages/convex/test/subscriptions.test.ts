import { describe, expect, test } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { createBoard, createItem, setup } from "./setup.js";

describe("subscriptions", () => {
  test("subscribes with default notification flags", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.subscriptions.subscribe, {
      itemId,
      actorId: "carol",
    });
    const subs = await t.query(api.subscriptions.subscribers, { itemId });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      actorId: "carol",
      notifyComments: true,
      notifyStatusChanges: true,
    });
  });

  test("resubscribing updates flags instead of duplicating", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.subscriptions.subscribe, {
      itemId,
      actorId: "carol",
      notifyComments: false,
    });
    const subs = await t.query(api.subscriptions.subscribers, { itemId });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      notifyComments: false,
      notifyStatusChanges: true,
    });
  });

  test("unsubscribing removes exactly once", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const missing = await t.mutation(api.subscriptions.unsubscribe, {
      itemId,
      actorId: "carol",
    });
    expect(missing).toBe(false);
    await t.mutation(api.subscriptions.subscribe, {
      itemId,
      actorId: "carol",
    });
    const removed = await t.mutation(api.subscriptions.unsubscribe, {
      itemId,
      actorId: "carol",
    });
    expect(removed).toBe(true);
    const subs = await t.query(api.subscriptions.subscribers, { itemId });
    expect(subs).toEqual([]);
  });
});
