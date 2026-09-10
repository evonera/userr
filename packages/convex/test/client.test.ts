import { describe, expect, test } from "vitest";

import {
  assertTransitionAllowed,
  requireActor,
  requireModerator,
  type FeedbackHostConfig,
} from "../src/client/index.js";

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
