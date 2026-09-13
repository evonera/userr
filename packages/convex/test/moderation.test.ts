import { describe, expect, test } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { createBoard, createItem, ghostId, setup } from "./setup.js";

describe("moderation", () => {
  test("report queues, review decides", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.moderation.report, {
      itemId,
      actorId: "alice",
      reason: "spam?",
    });
    const queued = await t.query(api.items.list, {
      boardId,
      moderation: "pending",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(queued.page.map((i) => i._id)).toContain(itemId);
    await t.mutation(api.moderation.review, {
      itemId,
      decision: "approved",
      actorId: "moderator",
    });
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item.moderation).toBe("approved");
  });

  test("blocked actors cannot write", async () => {    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.moderation.block, {
      boardId,
      actorId: "spammer",
      reason: "spam",
    });
    expect(
      await t.query(api.moderation.isBlocked, {
        boardId,
        actorId: "spammer",
      }),
    ).toBe(true);
    await expect(
      createItem(t, boardId, { actorId: "spammer", title: "Spam" }),
    ).rejects.toThrow(/blocked/i);
    await expect(
      t.mutation(api.items.vote, { itemId, actorId: "spammer" }),
    ).rejects.toThrow(/blocked/i);
    await expect(
      t.mutation(api.comments.create, {
        itemId,
        actorId: "spammer",
        body: "Spam.",
      }),
    ).rejects.toThrow(/blocked/i);
    await t.mutation(api.moderation.unblock, {
      boardId,
      actorId: "spammer",
    });
    await t.mutation(api.items.vote, { itemId, actorId: "spammer" });
  });

  test("bulk transitions apply all-or-nothing", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const a = await createItem(t, boardId, { title: "A" });
    const b = await createItem(t, boardId, { title: "B" });
    const result = await t.mutation(api.items.setStateMany, {
      itemIds: [a, b],
      state: "planned",
      actorId: "moderator",
    });
    expect(result).toEqual({ updated: 2 });
    await expect(
      t.mutation(api.items.setStateMany, {
        itemIds: [a, ghostId(a) as never],
        state: "closed",
        actorId: "moderator",
      }),
    ).rejects.toThrow();
    const got = await t.query(api.items.get, { itemId: a });
    expect(got?.item.state).toBe("planned");
  });

  test("spam is hidden from public reads, visible to moderators", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId, { title: "Spammy" });
    await t.mutation(api.moderation.report, {
      itemId,
      actorId: "alice",
    });
    await t.mutation(api.moderation.review, {
      itemId,
      decision: "spam",
      actorId: "moderator",
    });
    expect(await t.query(api.items.get, { itemId })).toBeNull();
    const viaFlag = await t.query(api.items.get, {
      itemId,
      includeModerated: true,
    });
    expect(viaFlag?.item.moderation).toBe("spam");
    const listed = await t.query(api.items.list, {
      boardId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page.map((i) => i._id)).not.toContain(itemId);
    await expect(
      t.mutation(api.items.vote, { itemId, actorId: "carol" }),
    ).rejects.toThrow();
  });
});
