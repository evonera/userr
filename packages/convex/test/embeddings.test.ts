import { describe, expect, test } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { createBoard, createItem, ghostId, setup } from "./setup.js";

const DIMENSIONS = 1536;
const unitVector = (first: number): number[] => {
  const vec = new Array(DIMENSIONS).fill(0);
  vec[0] = first;
  return vec;
};

describe("embeddings", () => {
  test("new items await enrichment, then leave the queue", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId, { title: "Dark mode" });
    const pending = await t.query(api.embeddings.pendingEnrichment, {});
    expect(pending.map((p) => p.itemId)).toContain(itemId);
    expect(pending.find((p) => p.itemId === itemId)?.text).toContain(
      "Dark mode",
    );
    await t.mutation(api.embeddings.storeEmbedding, {
      itemId,
      embedding: unitVector(1),
    });
    const after = await t.query(api.embeddings.pendingEnrichment, {});
    expect(after.map((p) => p.itemId)).not.toContain(itemId);
  });

  test("rejects empty embeddings and unknown items", async () => {    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await expect(
      t.mutation(api.embeddings.storeEmbedding, { itemId, embedding: [] }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.embeddings.storeEmbedding, {
        itemId: ghostId(itemId) as never,
        embedding: unitVector(1),
      }),
    ).rejects.toThrow("Feedback item not found.");
  });

  test("rejects wrong-dimension vectors", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await expect(
      t.mutation(api.embeddings.storeEmbedding, {
        itemId,
        embedding: [0.1, 0.2],
      }),
    ).rejects.toThrow(/dimensions/);
  });

  test("stored vectors stay out of public item views", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.embeddings.storeEmbedding, {
      itemId,
      embedding: unitVector(1),
    });
    // Raw vectors would fail the public validators (and waste bandwidth).
    const got = await t.query(api.items.get, { itemId });
    expect(got?.item).not.toHaveProperty("embedding");
    const top = await t.query(api.items.listTop, { boardId });
    expect(top[0]).not.toHaveProperty("embedding");
  });

  test("disabling removes an item from the queue", async () => {    const t = setup();
    const boardId = await createBoard(t);
    const itemId = await createItem(t, boardId);
    await t.mutation(api.embeddings.disableEnrichment, { itemId });
    const pending = await t.query(api.embeddings.pendingEnrichment, {});
    expect(pending.map((p) => p.itemId)).not.toContain(itemId);
  });

  // convex-test implements neither vector index queries nor the vectorSearch
  // syscall, so this case is deployment-gated: it runs against the example
  // app once a dev deployment is authorized (see docs/context.md). The action
  // uses only the standard `ctx.vectorSearch` API the schema declares.
  test.skip("vector search finds semantically close items", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const close = await createItem(t, boardId, { title: "Close match" });
    const far = await createItem(t, boardId, { title: "Far match" });
    await t.mutation(api.embeddings.storeEmbedding, {
      itemId: close,
      embedding: unitVector(1),
    });
    await t.mutation(api.embeddings.storeEmbedding, {
      itemId: far,
      embedding: unitVector(-1),
    });
    const hits = await t.query(api.embeddings.findSimilarVector, {
      boardId,
      embedding: unitVector(1),
      limit: 5,
    });
    expect(hits[0]?.id).toBe(close);
    expect(hits.map((h) => h.id)).toContain(far);
  });
});
