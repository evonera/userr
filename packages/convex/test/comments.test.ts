import { describe, expect, test } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { createBoard, createItem, setup } from "./setup.js";

describe("comments", () => {
  test("creates top-level comments and bumps the count", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const commentId = await t.mutation(api.comments.create, {
      itemId,
      actorId: "carol",
      body: "I need this too.",
    });
    const comment = await t.query(api.comments.get, { commentId });
    expect(comment?.body).toBe("I need this too.");
    expect(comment?.parentId).toBeUndefined();
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item.commentCount).toBe(1);
  });

  test("supports one reply level and rejects cross-item parents", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const otherId = await createItem(t, boardId, { title: "Other" });
    const parent = await t.mutation(api.comments.create, {
      itemId,
      actorId: "carol",
      body: "Parent.",
    });
    const reply = await t.mutation(api.comments.create, {
      itemId,
      actorId: "dave",
      body: "Reply.",
      parentId: parent,
    });
    const fetched = await t.query(api.comments.get, { commentId: reply });
    expect(fetched?.parentId).toBe(parent);
    const foreign = await t.mutation(api.comments.create, {
      itemId: otherId,
      actorId: "carol",
      body: "Foreign parent holder.",
    });
    await expect(
      t.mutation(api.comments.create, {
        itemId,
        actorId: "carol",
        body: "Bad reply.",
        parentId: foreign,
      }),
    ).rejects.toThrow();
  });

  test("enforces the maximum reply depth", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    let parent: string | undefined;
    // Depth budget is 5: one root plus four replies.
    for (let level = 0; level < 5; level++) {
      parent = (await t.mutation(api.comments.create, {
        itemId,
        actorId: "carol",
        body: `Level ${level}.`,
        ...(parent ? { parentId: parent } : {}),
      })) as string;
    }
    await expect(
      t.mutation(api.comments.create, {
        itemId,
        actorId: "carol",
        body: "Too deep.",
        parentId: parent,
      }),
    ).rejects.toThrow();
  });

  test("lists comments oldest-first with pagination", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.comments.create, {
        itemId,
        actorId: "carol",
        body: `Comment ${i}.`,
      });
    }
    const page = await t.query(api.comments.list, {
      itemId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(page.page.map((c) => c.body)).toEqual(["Comment 0.", "Comment 1."]);
    expect(page.isDone).toBe(false);
    const rest = await t.query(api.comments.list, {
      itemId,
      paginationOpts: { numItems: 2, cursor: page.continueCursor },
    });
    expect(rest.page.map((c) => c.body)).toEqual(["Comment 2."]);
    expect(rest.isDone).toBe(true);
  });

  test("authors edit; others need the moderator flag", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const commentId = await t.mutation(api.comments.create, {
      itemId,
      actorId: "carol",
      body: "Original.",
    });
    await t.mutation(api.comments.edit, {
      commentId,
      actorId: "carol",
      body: "Edited.",
    });
    const edited = await t.query(api.comments.get, { commentId });
    expect(edited?.body).toBe("Edited.");
    await expect(
      t.mutation(api.comments.edit, {
        commentId,
        actorId: "dave",
        body: "Hijacked.",
      }),
    ).rejects.toThrow();
    await t.mutation(api.comments.edit, {
      commentId,
      actorId: "moderator",
      body: "Moderated.",
      asModerator: true,
    });
    const moderated = await t.query(api.comments.get, { commentId });
    expect(moderated?.body).toBe("Moderated.");
  });

  test("removal tombstones the comment and decrements the count", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const commentId = await t.mutation(api.comments.create, {
      itemId,
      actorId: "carol",
      body: "Regret.",
    });
    await t.mutation(api.comments.remove, {
      commentId,
      actorId: "carol",
    });
    const tombstone = await t.query(api.comments.get, { commentId });
    expect(tombstone?.body).toBeNull();
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item.commentCount).toBe(0);
    await expect(
      t.mutation(api.comments.remove, {
        commentId,
        actorId: "carol",
      }),
    ).rejects.toThrow();
  });

  test("rejects replies to deleted parents", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    const parent = await t.mutation(api.comments.create, {
      itemId,
      actorId: "carol",
      body: "Doomed.",
    });
    await t.mutation(api.comments.remove, {
      commentId: parent,
      actorId: "carol",
    });
    await expect(
      t.mutation(api.comments.create, {
        itemId,
        actorId: "dave",
        body: "Orphan.",
        parentId: parent,
      }),
    ).rejects.toThrow();
  });
});
