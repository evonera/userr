import { afterEach, describe, expect, test } from "vitest";

import { createRequestHandler } from "../src/handler.js";
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

describe("request handler", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) {
      await close();
      close = null;
    }
  });

  test("full item lifecycle over HTTP", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const handle = createRequestHandler({
      db,
      identify: async (req) => req.headers.get("x-actor"),
      resolveRole: async (actorId) =>
        actorId === "moderator" ? "moderator" : "member",
      transitions: [
        { from: "inbox", to: "open", roles: ["moderator"] },
        { from: "open", to: "planned", roles: ["moderator"] },
      ],
    });
    const call = async (
      path: string,
      init?: { method?: string; body?: unknown; actor?: string },
    ) => {
      const res = await handle(request(path, init));
      return { status: res.status, body: (await res.json()) as never } as {
        status: number;
        body: Record<string, unknown>;
      };
    };

    // Writes require authentication.
    const anon = await call("/boards", {
      method: "POST",
      body: { slug: "feedback", name: "Feedback" },
    });
    expect(anon.status).toBe(401);

    const created = await call("/boards", {
      method: "POST",
      actor: "moderator",
      body: { slug: "feedback", name: "Feedback" },
    });
    expect(created.status).toBe(201);
    const boardId = created.body.id as string;

    const bySlug = await call("/boards?slug=feedback");
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.id).toBe(boardId);

    const item = await call("/items", {
      method: "POST",
      actor: "alice",
      body: { boardId, title: "Dark mode", body: "Please.", kind: "idea" },
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const listed = await call(`/items?boardId=${boardId}`);
    expect(
      (listed.body.items as { id: string }[]).map((i) => i.id),
    ).toContain(itemId);

    const voted = await call(`/items/${itemId}/vote`, {
      method: "POST",
      actor: "carol",
    });
    expect(voted.body).toMatchObject({ added: true, voteCount: 1 });

    const commented = await call(`/items/${itemId}/comments`, {
      method: "POST",
      actor: "carol",
      body: { body: "I need this." },
    });
    expect(commented.status).toBe(201);

    const subscribed = await call(`/items/${itemId}/subscribe`, {
      method: "POST",
      actor: "carol",
    });
    expect(subscribed.body).toEqual({ ok: true });

    const similar = await call(
      `/similar?boardId=${boardId}&title=${encodeURIComponent("dark mode")}`,
    );
    expect(similar.body.exact).toBe(itemId);

    // Members cannot transition; moderators follow the configured machine.
    const forbidden = await call(`/items/${itemId}/state`, {
      method: "POST",
      actor: "alice",
      body: { state: "open" },
    });
    expect(forbidden.status).toBe(403);
    const transitioned = await call(`/items/${itemId}/state`, {
      method: "POST",
      actor: "moderator",
      body: { state: "open" },
    });
    expect(transitioned.body).toEqual({ ok: true });
    const illegal = await call(`/items/${itemId}/state`, {
      method: "POST",
      actor: "moderator",
      body: { state: "shipped" },
    });
    expect(illegal.status).toBe(400);
    const garbage = await call(`/items/${itemId}/state`, {
      method: "POST",
      actor: "moderator",
      body: { state: "archived_forever" },
    });
    expect(garbage.status).toBe(400);
    const mergedState = await call(`/items/${itemId}/state`, {
      method: "POST",
      actor: "moderator",
      body: { state: "merged" },
    });
    expect(mergedState.status).toBe(400);

    const second = await call("/items", {
      method: "POST",
      actor: "alice",
      body: { boardId, title: "Dark theme", body: "Same.", kind: "idea" },
    });
    const merged = await call(`/items/${second.body.id}/merge`, {
      method: "POST",
      actor: "moderator",
      body: { targetId: itemId, reason: "duplicate" },
    });
    expect(merged.body).toEqual({ ok: true });

    const events = await call(`/items/${second.body.id}/events`);
    expect(
      (events.body as unknown as { type: string }[]).map((e) => e.type),
    ).toContain("merged");

    // Unknown routes and malformed bodies fail cleanly.
    expect((await call("/nope")).status).toBe(404);
    const bad = await handle(
      new Request(`${BASE}/items`, {
        method: "POST",
        headers: { "x-actor": "alice", "content-type": "application/json" },
        body: "{invalid",
      }),
    );
    expect(bad.status).toBe(400);
  });

  test("moderator paths fail closed without role resolution", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const handle = createRequestHandler({
      db,
      identify: async (req) => req.headers.get("x-actor"),
    });
    const board = (await (
      await handle(
        request("/boards", {
          method: "POST",
          actor: "owner",
          body: { slug: "b", name: "B" },
        }),
      )
    ).json()) as { id: string };
    const item = (await (
      await handle(
        request("/items", {
          method: "POST",
          actor: "owner",
          body: {
            boardId: board.id,
            title: "T",
            body: "",
            kind: "idea",
          },
        }),
      )
    ).json()) as { id: string };
    const res = await handle(
      request(`/items/${item.id}/state`, {
        method: "POST",
        actor: "owner",
        body: { state: "open" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("changelog and lane reads serve published content", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const handle = createRequestHandler({
      db,
      identify: async (req) => req.headers.get("x-actor"),
    });
    const empty = await handle(request("/changelog?boardId=missing"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ items: [] });

    const board = (await (
      await handle(
        request("/boards", {
          method: "POST",
          actor: "owner",
          body: { slug: "b", name: "B" },
        }),
      )
    ).json()) as { id: string };
    const { createRepository } = await import("../src/repository.js");
    const repo = createRepository(db);
    await repo.publishChangelogEntry({
      boardId: board.id,
      title: "Launch",
      body: "We launched.",
      linkedItemIds: [],
    });
    await repo.saveLane({
      boardId: board.id,
      name: "Now",
      states: ["in_progress"],
      order: 0,
    });

    const changelog = (await (
      await handle(request(`/changelog?boardId=${board.id}`))
    ).json()) as { items: { title: string }[] };
    expect(changelog.items.map((e) => e.title)).toContain("Launch");

    const lanes = (await (
      await handle(request(`/lanes?boardId=${board.id}`))
    ).json()) as { name: string }[];
    expect(lanes.map((l) => l.name)).toContain("Now");

    const missingBoard = await handle(request("/lanes"));
    expect(missingBoard.status).toBe(400);
  });
});
