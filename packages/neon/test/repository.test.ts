import { afterEach, describe, expect, test } from "vitest";

import { createRepository, storeEmbedding } from "../src/repository.js";
import { repository, setupDatabase, type TestDb } from "./setup.js";

describe("repository guards", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) {
      await close();
      close = null;
    }
  });

  test("rejects wrong-dimension embeddings", async () => {
    const setup: { db: TestDb; close: () => Promise<void> } =
      await setupDatabase();
    close = setup.close;
    const repo = repository(setup.db);
    const board = await repo.createBoard({
      slug: "b",
      name: "B",
      visibility: "public",
      allowedKinds: ["idea"],
      statusOrder: ["inbox"],
    });
    const item = await repo.createItem({
      boardId: board.id,
      title: "T",
      body: "",
      kind: "idea",
      authorId: "alice",
    });
    await expect(
      storeEmbedding(setup.db, { itemId: item.id, embedding: [0.1] }),
    ).rejects.toThrow(/dimensions/);
  });

  test("rejects merging away a shipped source", async () => {
    const setup: { db: TestDb; close: () => Promise<void> } =
      await setupDatabase();
    close = setup.close;
    const repo = createRepository(setup.db);
    const board = await repo.createBoard({
      slug: "b",
      name: "B",
      visibility: "public",
      allowedKinds: ["idea"],
      statusOrder: ["inbox", "shipped"],
    });
    const shipped = await repo.createItem({
      boardId: board.id,
      title: "Shipped",
      body: "",
      kind: "idea",
      authorId: "alice",
    });
    await repo.setState({
      itemId: shipped.id,
      state: "shipped",
      actorId: "moderator",
    });
    const spare = await repo.createItem({
      boardId: board.id,
      title: "Spare",
      body: "",
      kind: "idea",
      authorId: "alice",
    });
    await expect(
      repo.merge({
        sourceId: shipped.id,
        targetId: spare.id,
        actorId: "moderator",
        mergedAt: Date.now(),
      }),
    ).rejects.toThrow(/completed or canonical/);
  });
});
