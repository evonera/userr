import { describe, expect, test } from "vitest";

import {
  assertTransitionAllowed,
  createWidgetHostHandler,
  requireActor,
  requireModerator,
  type FeedbackHostConfig,
} from "../src/client/index.js";
import { signWidgetToken } from "@userr/core";
import { api } from "../src/component/_generated/api.js";
import { createBoard, setup } from "./setup.js";

function config(overrides: Partial<FeedbackHostConfig> = {}) {
  return {
    resolveActorId: async () => "carol",
    ...overrides,
  } satisfies FeedbackHostConfig;
}

describe("host guards", () => {
  test("requireActor rejects anonymous callers", () => {
    expect(() => requireActor(null)).toThrow("Authentication is required");
    expect(requireActor("carol")).toBe("carol");
  });

  test("requireModerator honors roles, then legacy canModerate", async () => {
    const roleBased = config({
      resolveRole: async (actorId) =>
        actorId === "moderator" ? "moderator" : "member",
    });
    await expect(
      requireModerator({ ...roleBased, resolveActorId: async () => "member" }, "b"),
    ).rejects.toThrow("Moderation rights");
    await expect(
      requireModerator(
        { ...roleBased, resolveActorId: async () => "moderator" },
        "b",
      ),
    ).resolves.toBe("moderator");

    const legacy = config({
      canModerate: async (actorId) => actorId === "owner",
    });
    await expect(
      requireModerator({ ...legacy, resolveActorId: async () => "owner" }, "b"),
    ).resolves.toBe("owner");
    await expect(requireModerator(legacy, "b")).rejects.toThrow(
      "Moderation rights",
    );
  });

  test("assertTransitionAllowed defers to core rules", () => {
    const cfg = config({
      transitions: [{ from: "inbox", to: "open", roles: ["moderator"] }],
    });
    expect(() =>
      assertTransitionAllowed(cfg, "inbox", "open", "moderator"),
    ).not.toThrow();
    expect(() =>
      assertTransitionAllowed(cfg, "inbox", "open", "member"),
    ).toThrow();
    expect(() =>
      assertTransitionAllowed(cfg, "inbox", "shipped", "moderator"),
    ).toThrow();
  });
});

describe("Convex widget host handler", () => {
  test("keeps token verification host-side and bridges guarded mutations", async () => {
    const t = setup(); const boardId = await createBoard(t); const secret = "convex-widget-secret-with-at-least-32-bytes"; const now = Date.now();
    const hostToken = await signWidgetToken(secret, { version: 1, boardId, subject: "visitor-1", nonce: "nonce-1", issuedAt: now, expiresAt: now + 60_000 });
    const handler = createWidgetHostHandler({
      secret,
      networkFingerprint: async () => "host-hash:network",
      subjectLimit: { limit: 1, windowMs: 60_000 },
      consumeAllOrNothing: async (requests) => await t.mutation(api.rateLimits.consumeAllOrNothing, { requests }),
      createItem: async (input) => ({ id: await t.mutation(api.items.create, input) }),
    });
    const submit = () => handler(new Request("http://host.test/api/userr/widget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId, hostToken, title: "Keyboard mode", body: "Please.", category: "feature" }) }));
    const created = await submit(); expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const item = await t.query(api.items.get, { itemId: id });
    expect(item?.item).toMatchObject({ authorId: "visitor-1", kind: "idea" });
    const denied = await submit(); expect(denied.status).toBe(429); expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);

    const questionToken = await signWidgetToken(secret, { version: 1, boardId, subject: "visitor-2", nonce: "nonce-2", issuedAt: now, expiresAt: now + 60_000 });
    const question = await handler(new Request("http://host.test/api/userr/widget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId, hostToken: questionToken, title: "How does this work?", category: "question" }) }));
    expect(question.status).toBe(201);
    const questionId = ((await question.json()) as { id: string }).id;
    expect((await t.query(api.items.get, { itemId: questionId }))?.item.kind).toBe("feedback");
  });

  test("sanitizes host callback failures", async () => {
    const handler = createWidgetHostHandler({ secret: "convex-widget-secret-with-at-least-32-bytes", networkFingerprint: async () => { throw new Error("proxy secret"); }, consumeAllOrNothing: async () => ({ allowed: true }), createItem: async () => { throw new Error("database secret"); } });
    const response = await handler(new Request("http://host.test/widget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId: "b", hostToken: "bad", title: "T", category: "bug" }) }));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("proxy secret");

    const now = Date.now(); const secret = "convex-widget-secret-with-at-least-32-bytes";
    const token = await signWidgetToken(secret, { version: 1, boardId: "b", subject: "visitor", nonce: "nonce", issuedAt: now, expiresAt: now + 60_000 });
    const failingLimiter = createWidgetHostHandler({ secret, networkFingerprint: async () => "hash", consumeAllOrNothing: async () => { throw new Error("database connection secret"); }, createItem: async () => ({}) });
    const limiterResponse = await failingLimiter(new Request("http://host.test/widget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId: "b", hostToken: token, title: "T", category: "bug" }) }));
    expect(limiterResponse.status).toBe(500); expect(await limiterResponse.text()).not.toContain("database connection secret");
  });
});
