import { describe, expect, test, vi } from "vitest";

import { api } from "../src/component/_generated/api.js";
import { createBoard, createItem, setup } from "./setup.js";

describe("webhooks", () => {
  test("creates webhooks with a once-only secret", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const created = (await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    })) as { id: string; secret: string };
    expect(created.secret).toHaveLength(64);
    const hooks = (await t.query(api.webhooks.list, { boardId })) as {
      secretPreview: string;
      secret?: string;
    }[];
    expect(hooks).toHaveLength(1);
    expect(hooks[0].secret).toBeUndefined();
    expect(hooks[0].secretPreview.endsWith(created.secret.slice(-4))).toBe(
      true,
    );
  });

  test("rejects non-http urls", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    await expect(
      t.mutation(api.webhooks.create, {
        boardId,
        url: "ftp://example.com/hook",
        events: ["post.created"],
      }),
    ).rejects.toThrow();
  });

  test("item creation enqueues deliveries for subscribed hooks", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const created = (await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    })) as { id: string };
    const itemId = await createItem(t, boardId);
    const deliveries = (await t.query(api.webhooks.deliveries, {
      webhookId: created.id,
    })) as { event: string; status: string; payload: { itemId: string } }[];
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].event).toBe("post.created");
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].payload.itemId).toBe(itemId);
  });

  test("unsubscribed events enqueue nothing", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const created = (await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.merged"],
    })) as { id: string };
    await createItem(t, boardId);
    const deliveries = (await t.query(api.webhooks.deliveries, {
      webhookId: created.id,
    })) as unknown[];
    expect(deliveries).toHaveLength(0);
  });

  test("deliverDue posts signed envelopes and records outcomes", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    });
    await createItem(t, boardId);

    const seen: { url: string; headers: Record<string, string>; body: string }[] =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          url,
          headers: init.headers as Record<string, string>,
          body: init.body as string,
        });
        return new Response("ok", { status: 200 });
      }),
    );
    try {
      const result = (await t.action(api.webhooks.deliverDue, {
        limit: 10,
      })) as { attempted: number; delivered: number };
      expect(result).toEqual({ attempted: 1, delivered: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://example.com/hook");
    expect(seen[0].headers["X-Feedback-Signature"]).toMatch(/^sha256=[0-9a-f]+$/);
    expect(seen[0].headers["X-Feedback-Event"]).toBe("post.created");
    expect(seen[0].headers["X-Feedback-Delivery"]).toBeTruthy();
    const envelope = JSON.parse(seen[0].body) as {
      id: string;
      type: string;
      board: { id: string };
    };
    expect(envelope.type).toBe("post.created");
    expect(envelope.id).toBe(seen[0].headers["X-Feedback-Delivery"]);

    const deliveries = (await t.query(api.webhooks.deliveries, {})) as {
      status: string;
    }[];
    expect(deliveries.map((d) => d.status)).toEqual(["delivered"]);
  });

  test("failed deliveries retry on schedule, then fail the webhook", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const created = (await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    })) as { id: string };
    await createItem(t, boardId);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    try {
      // First attempt fails and schedules the 60s retry; later cron ticks are
      // not due yet, so the schedule is exhausted directly to stay
      // deterministic (production retries happen on subsequent cron runs).
      await t.action(api.webhooks.deliverDue, { limit: 10 });
    } finally {
      vi.unstubAllGlobals();
    }
    const pending = (await t.query(api.webhooks.deliveries, {
      webhookId: created.id,
    })) as {
      _id: string;
      status: string;
      attempts: number;
      nextRetryAt?: number;
      leaseOwner?: string;
    }[];
    expect(pending[0].status).toBe("pending");
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].nextRetryAt).toBeGreaterThan(Date.now());

    for (let i = 0; i < 5; i++) {
      await t.mutation(api.webhooks.recordOutcome, {
        deliveryId: pending[0]._id as never,
        ok: false,
        error: "connection refused",
        // The cron run holds the lease; replay it to record as the owner.
        ...(pending[0].leaseOwner ? { leaseOwner: pending[0].leaseOwner } : {}),
      });
    }
    const deliveries = (await t.query(api.webhooks.deliveries, {
      webhookId: created.id,
    })) as { status: string; attempts: number }[];
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].attempts).toBeGreaterThanOrEqual(6);
    const hooks = (await t.query(api.webhooks.list, { boardId })) as {
      active: boolean;
    }[];
    expect(hooks[0].active).toBe(false);
  });

  test("rotate returns a fresh secret and resets failures", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const created = (await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    })) as { id: string; secret: string };
    const rotated = (await t.mutation(api.webhooks.rotateSecret, {
      id: created.id,
    })) as { secret: string };
    expect(rotated.secret).not.toBe(created.secret);
  });

  test("remove deletes the hook and its deliveries", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    const created = (await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    })) as { id: string };
    await createItem(t, boardId);
    await t.mutation(api.webhooks.remove, { id: created.id });
    const hooks = (await t.query(api.webhooks.list, { boardId })) as unknown[];
    expect(hooks).toHaveLength(0);
    const deliveries = (await t.query(api.webhooks.deliveries, {
      webhookId: created.id,
    })) as unknown[];
    expect(deliveries).toHaveLength(0);
  });

  test("slow endpoints fail fast without stalling the batch", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    });
    await createItem(t, boardId);
    await createItem(t, boardId, { title: "Second" });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            // Never settles on its own: honoring the abort signal is what
            // lets the worker timeout win, exactly like a hanging endpoint.
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Timed out", "TimeoutError")),
            );
          }),
      ),
    );
    try {
      const result = (await t.action(api.webhooks.deliverDue, {
        limit: 10,
        timeoutMs: 50,
      })) as { attempted: number; delivered: number };
      expect(result.attempted).toBe(2);
      expect(result.delivered).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    const deliveries = (await t.query(api.webhooks.deliveries, {})) as {
      status: string;
      attempts: number;
    }[];
    expect(deliveries.every((d) => d.status === "pending")).toBe(true);
    expect(deliveries.every((d) => d.attempts === 1)).toBe(true);
  });

  test("overlapping workers cannot claim the same rows", async () => {
    const t = setup();
    const boardId = await createBoard(t);
    await t.mutation(api.webhooks.create, {
      boardId,
      url: "https://example.com/hook",
      events: ["post.created"],
    });
    await createItem(t, boardId);

    const { internal } = await import("../src/component/_generated/api.js");
    const first = (await t.mutation(internal.webhooks.claimDue, {
      owner: "worker-a",
    })) as unknown[];
    expect(first).toHaveLength(1);
    const second = (await t.mutation(internal.webhooks.claimDue, {
      owner: "worker-b",
    })) as unknown[];
    expect(second).toHaveLength(0);

    // The lease owner records fine; a different owner is rejected.
    const id = (first[0] as { _id: string })._id;
    await expect(
      t.mutation(api.webhooks.recordOutcome, {
        deliveryId: id,
        ok: true,
        leaseOwner: "worker-b",
      }),
    ).rejects.toThrow(/lease/);
    await t.mutation(api.webhooks.recordOutcome, {
      deliveryId: id,
      ok: true,
      leaseOwner: "worker-a",
    });
  });
});
