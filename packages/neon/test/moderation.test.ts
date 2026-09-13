import { afterEach, describe, expect, test } from "vitest";

import { createRequestHandler } from "../src/handler.js";
import { createRepository } from "../src/repository.js";
import { setupDatabase } from "./setup.js";

const BASE = "http://test.local/api/userr";

function request(
  path: string,
  init: { method?: string; body?: unknown; actor?: string } = {},
): Request {
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(init.actor ? { "x-actor": init.actor } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

type Called = { status: number; body: Record<string, unknown> };

describe("moderation routes", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) {
      await close();
      close = null;
    }
  });

  async function setup() {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const handle = createRequestHandler({
      db,
      identify: async (req) => req.headers.get("x-actor"),
      resolveRole: async (actorId) =>
        actorId === "moderator" ? "moderator" : "member",
    });
    const call = async (
      path: string,
      init?: { method?: string; body?: unknown; actor?: string },
    ): Promise<Called> => {
      const res = await handle(request(path, init));
      return { status: res.status, body: (await res.json()) as never } as Called;
    };
    const created = await call("/boards", {
      method: "POST",
      actor: "owner",
      body: { slug: "b", name: "B" },
    });
    return { db, handle, call, board: created.body as { id: string } };
  }

  test("report queues, review decides, queue lists pending", async () => {
    const { call, board } = await setup();
    const created = await call("/items", {
      method: "POST",
      actor: "alice",
      body: { boardId: board.id, title: "T", body: "", kind: "idea" },
    });
    const item = created.body as { id: string };

    await call(`/items/${item.id}/report`, {
      method: "POST",
      actor: "alice",
      body: { reason: "spam?" },
    });
    const queued = await call(`/moderation?boardId=${board.id}`, {
      actor: "moderator",
    });
    expect(
      (queued.body.items as { id: string }[]).map((i) => i.id),
    ).toContain(item.id);

    const memberQueue = await call(`/moderation?boardId=${board.id}`, {
      actor: "alice",
    });
    expect(memberQueue.status).toBe(403);

    await call(`/items/${item.id}/review`, {
      method: "POST",
      actor: "moderator",
      body: { decision: "spam" },
    });
    const after = await call(`/moderation?boardId=${board.id}`, {
      actor: "moderator",
    });
    expect(after.body.items).toHaveLength(0);
  });

  test("bulk transitions apply atomically within one board", async () => {
    const { call, board } = await setup();
    const createdA = await call("/items", {
      method: "POST",
      actor: "alice",
      body: { boardId: board.id, title: "A", body: "", kind: "idea" },
    });
    const createdB = await call("/items", {
      method: "POST",
      actor: "alice",
      body: { boardId: board.id, title: "B", body: "", kind: "idea" },
    });
    const a = createdA.body as { id: string };
    const b = createdB.body as { id: string };

    const ok = await call("/items/bulk/state", {
      method: "POST",
      actor: "moderator",
      body: { boardId: board.id, itemIds: [a.id, b.id], state: "planned" },
    });
    expect(ok.body).toEqual({ updated: 2 });

    // Unknown ids reject the whole batch; nothing is persisted.
    const bad = await call("/items/bulk/state", {
      method: "POST",
      actor: "moderator",
      body: { boardId: board.id, itemIds: [a.id, "item_missing"], state: "closed" },
    });
    expect(bad.status).toBe(400);
    const single = await call(`/items/${a.id}`, { actor: "moderator" });
    expect((single.body as { state: string }).state).toBe("planned");

    // Cross-board ids are rejected.
    const otherBoard = await call("/boards", {
      method: "POST",
      actor: "owner",
      body: { slug: "other", name: "Other" },
    });
    const foreign = await call("/items", {
      method: "POST",
      actor: "alice",
      body: {
        boardId: (otherBoard.body as { id: string }).id,
        title: "F",
        body: "",
        kind: "idea",
      },
    });
    const cross = await call("/items/bulk/state", {
      method: "POST",
      actor: "moderator",
      body: {
        boardId: board.id,
        itemIds: [a.id, (foreign.body as { id: string }).id],
        state: "closed",
      },
    });
    expect(cross.status).toBe(400);
  });

  test("blocked actors cannot write until unblocked", async () => {
    const { call, board, db } = await setup();
    await call("/blocks", {
      method: "POST",
      actor: "moderator",
      body: { boardId: board.id, actorId: "spammer", reason: "spam" },
    });
    const denied = await call("/items", {
      method: "POST",
      actor: "spammer",
      body: { boardId: board.id, title: "Spam", body: "", kind: "idea" },
    });
    expect(denied.status).toBe(403);

    const repo = createRepository(db);
    expect(
      await repo.isBlocked({ boardId: board.id, actorId: "spammer" }),
    ).toBe(true);
    await call(`/blocks?boardId=${board.id}&actorId=spammer`, {
      method: "DELETE",
      actor: "moderator",
    });
    expect(
      await repo.isBlocked({ boardId: board.id, actorId: "spammer" }),
    ).toBe(false);
    const allowed = await call("/items", {
      method: "POST",
      actor: "spammer",
      body: { boardId: board.id, title: "Fine", body: "", kind: "idea" },
    });
    expect(allowed.status).toBe(201);
  });

  test("spam is hidden from public reads, visible to moderators", async () => {
    const { call, board, db } = await setup();
    const created = await call("/items", {
      method: "POST",
      actor: "alice",
      body: { boardId: board.id, title: "Spammy", body: "", kind: "idea" },
    });
    const item = created.body as { id: string };
    const repo = createRepository(db);
    await repo.reportItem({ itemId: item.id, actorId: "alice" });
    await repo.reviewItem({
      itemId: item.id,
      decision: "spam",
      actorId: "moderator",
    });

    expect((await call(`/items/${item.id}`)).status).toBe(404);
    const staff = await call(`/items/${item.id}`, { actor: "moderator" });
    expect(staff.status).toBe(200);
    const listedRes = await call(`/items?boardId=${board.id}`);
    expect(
      ((listedRes.body as { items: { id: string }[] }).items).map((i) => i.id),
    ).not.toContain(item.id);
    const staffList = await call(`/items?boardId=${board.id}`, {
      actor: "moderator",
    });
    expect(
      ((staffList.body as { items: { id: string }[] }).items).map((i) => i.id),
    ).toContain(item.id);
  });
});
