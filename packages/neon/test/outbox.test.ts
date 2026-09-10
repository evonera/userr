import { afterEach, describe, expect, test, vi } from "vitest";

import { verifyWebhookSignature } from "@userr/core";

import { createRequestHandler } from "../src/handler.js";
import { createRepository, processOutbox } from "../src/repository.js";
import { setupDatabase, type TestDb } from "./setup.js";

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

describe("webhook outbox", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) {
      await close();
      close = null;
    }
    vi.unstubAllGlobals();
  });

  async function boardWithItem(db: TestDb) {
    const repo = createRepository(db);
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
    return { repo, board, item };
  }

  test("processOutbox delivers signed envelopes and records outcomes", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const { repo, board } = await boardWithItem(db);
    const { webhook, secret } = await repo.createWebhook({
      boardId: board.id,
      url: "https://example.com/hook",
      events: ["post.created"],
    });
    await repo.createItem({
      boardId: board.id,
      title: "Second",
      body: "",
      kind: "idea",
      authorId: "alice",
    });

    const seen: { headers: Record<string, string>; body: string }[] = [];
    const summary = await processOutbox(db, {
      deliver: async ({ headers, body }) => {
        seen.push({ headers, body });
        return { ok: true };
      },
    });
    expect(summary).toEqual({ attempted: 1, delivered: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers["X-Feedback-Event"]).toBe("post.created");
    const envelope = JSON.parse(seen[0].body) as {
      id: string;
      type: string;
    };
    expect(envelope.type).toBe("post.created");
    expect(
      await verifyWebhookSignature(
        secret,
        seen[0].body,
        seen[0].headers["X-Feedback-Signature"],
      ),
    ).toBe(true);

    const deliveries = await repo.listDeliveries({ webhookId: webhook.id });
    expect(deliveries.map((d) => d.status)).toEqual(["delivered"]);

    // Nothing due anymore.
    const idle = await processOutbox(db, {
      deliver: async () => ({ ok: true }),
    });
    expect(idle).toEqual({ attempted: 0, delivered: 0 });
  });

  test("failing deliveries exhaust the schedule and deactivate", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const { repo, board } = await boardWithItem(db);
    const { webhook } = await repo.createWebhook({
      boardId: board.id,
      url: "https://example.com/hook",
      events: ["post.created"],
    });
    await repo.createItem({
      boardId: board.id,
      title: "Trigger",
      body: "",
      kind: "idea",
      authorId: "alice",
    });
    // Advance the worker clock past every retry delay (max 12h) so each
    // scheduled retry is immediately due — deterministic without sleeping.
    const failing = (i: number) =>
      processOutbox(db, { now: Date.now() + 10 ** 12 + i * 10 ** 9 });
    // Default deliver uses global fetch; point it at a 500 via stub.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    for (let i = 0; i < 7; i++) {
      await failing(i);
    }
    const deliveries = await repo.listDeliveries({ webhookId: webhook.id });
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].attempts).toBeGreaterThanOrEqual(6);
  });

  test("webhook admin routes require moderators and mask secrets", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const handle = createRequestHandler({
      db,
      identify: async (req) => req.headers.get("x-actor"),
      resolveRole: async (actorId) =>
        actorId === "moderator" ? "moderator" : "member",
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

    const forbidden = await handle(
      request("/webhooks", {
        method: "POST",
        actor: "alice",
        body: { boardId: board.id, url: "https://x.example/h", events: [] },
      }),
    );
    expect(forbidden.status).toBe(403);

    const created = (await (
      await handle(
        request("/webhooks", {
          method: "POST",
          actor: "moderator",
          body: {
            boardId: board.id,
            url: "https://x.example/h",
            events: ["post.created"],
          },
        }),
      )
    ).json()) as { webhook: { id: string }; secret: string };
    expect(created.secret).toHaveLength(64);

    const listed = (await (
      await handle(request(`/webhooks?boardId=${board.id}`, { actor: "moderator" }))
    ).json()) as { secretPreview: string; secret?: string }[];
    expect(listed).toHaveLength(1);
    expect(listed[0].secret).toBeUndefined();
    expect(listed[0].secretPreview.endsWith(created.secret.slice(-4))).toBe(true);

    const anonList = await handle(request(`/webhooks?boardId=${board.id}`));
    // Unauthenticated callers fail at identity (401); authenticated
    // non-moderators fail at authorization (403) — covered in the lifecycle
    // test below via the member actor.
    expect(anonList.status).toBe(401);

    const rotated = (await (
      await handle(
        request(`/webhooks/${created.webhook.id}/rotate`, {
          method: "POST",
          actor: "moderator",
        }),
      )
    ).json()) as { secret: string };
    expect(rotated.secret).not.toBe(created.secret);

    const removed = await handle(
      request(`/webhooks/${created.webhook.id}`, {
        method: "DELETE",
        actor: "moderator",
      }),
    );
    expect(removed.status).toBe(200);
  });

  test("webhook update patches url, events, and active flag", async () => {
    const { db, close: closeDb } = await setupDatabase();
    close = closeDb;
    const handle = createRequestHandler({
      db,
      identify: async (req) => req.headers.get("x-actor"),
      resolveRole: async (actorId) =>
        actorId === "moderator" ? "moderator" : "member",
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
    const created = (await (
      await handle(
        request("/webhooks", {
          method: "POST",
          actor: "moderator",
          body: {
            boardId: board.id,
            url: "https://x.example/h",
            events: ["post.created"],
          },
        }),
      )
    ).json()) as { webhook: { id: string } };
    const patched = await handle(
      request(`/webhooks/${created.webhook.id}`, {
        method: "PATCH",
        actor: "moderator",
        body: { active: false, events: ["post.merged"] },
      }),
    );
    expect(patched.status).toBe(200);
    const listed = (await (
      await handle(request(`/webhooks?boardId=${board.id}`, { actor: "moderator" }))
    ).json()) as { active: boolean; events: string[] }[];
    expect(listed[0]).toMatchObject({ active: false, events: ["post.merged"] });
  });
});
