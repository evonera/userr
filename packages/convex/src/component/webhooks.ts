import {
  buildEnvelope,
  generateWebhookSecret,
  nextRetryAt,
  secretPreview,
  signWebhook,
  type WebhookEventType,
} from "@userr/core";
import { v } from "convex/values";

import {
  action,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { api, internal } from "./_generated/api.js";
import type { MutationCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";

const eventType = v.union(
  v.literal("post.created"),
  v.literal("post.status_changed"),
  v.literal("post.merged"),
  v.literal("comment.created"),
  v.literal("vote.milestone"),
  v.literal("changelog.published"),
);

const publicWebhook = v.object({
  _id: v.id("webhooks"),
  _creationTime: v.number(),
  boardId: v.id("boards"),
  url: v.string(),
  secretPreview: v.string(),
  events: v.array(v.string()),
  active: v.boolean(),
  failureCount: v.number(),
  lastError: v.optional(v.string()),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
});

const publicDelivery = v.object({
  _id: v.id("deliveries"),
  _creationTime: v.number(),
  webhookId: v.id("webhooks"),
  event: v.string(),
  payload: v.any(),
  status: v.union(
    v.literal("pending"),
    v.literal("delivered"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  nextRetryAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  deliveredAt: v.optional(v.number()),
  createdAt: v.number(),
});

function mask(doc: Doc<"webhooks">) {
  const { secret: _secret, ...rest } = doc;
  void _secret;
  return { ...rest, secretPreview: secretPreview(doc.secret) };
}

function checkUrl(url: string): string {
  if (!/^https?:\/\//.test(url)) {
    throw new Error("Webhook URL must be http(s).");
  }
  return url;
}

/**
 * Enqueue a fan-out for every active webhook on the board subscribed to the
 * event. Called inside the originating mutation so rows and outbox entries
 * commit atomically. Secrets are stored in the component's own tables — the
 * deployment's storage is the trust boundary (same posture as Fider);
 * encryption at rest comes from the platform.
 */
export async function enqueueEvent(
  ctx: MutationCtx,
  boardId: Id<"boards">,
  type: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const hooks = await ctx.db
    .query("webhooks")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .collect();
  for (const hook of hooks) {
    if (!hook.active || !hook.events.includes(type)) continue;
    await ctx.db.insert("deliveries", {
      webhookId: hook._id,
      event: type,
      payload,
      status: "pending",
      attempts: 0,
      nextRetryAt: now,
      createdAt: now,
    });
    await ctx.db.patch(hook._id, { lastTriggeredAt: now });
  }
}

export const create = mutation({
  args: {
    boardId: v.id("boards"),
    url: v.string(),
    events: v.array(eventType),
  },
  returns: v.object({ id: v.id("webhooks"), secret: v.string() }),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new Error("Board not found.");
    const secret = generateWebhookSecret();
    const id = await ctx.db.insert("webhooks", {
      boardId: args.boardId,
      url: checkUrl(args.url),
      secret,
      events: [...args.events],
      active: true,
      failureCount: 0,
      createdAt: Date.now(),
    });
    return { id, secret };
  },
});

export const list = query({
  args: { boardId: v.id("boards") },
  returns: v.array(publicWebhook),
  handler: async (ctx, args) => {
    const hooks = await ctx.db
      .query("webhooks")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .collect();
    return hooks.map(mask);
  },
});

export const get = query({
  args: { id: v.id("webhooks") },
  returns: v.union(publicWebhook, v.null()),
  handler: async (ctx, args) => {
    const hook = await ctx.db.get(args.id);
    return hook ? mask(hook) : null;
  },
});

export const update = mutation({  args: {
    id: v.id("webhooks"),
    url: v.optional(v.string()),
    events: v.optional(v.array(eventType)),
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hook = await ctx.db.get(args.id);
    if (!hook) throw new Error("Webhook not found.");
    await ctx.db.patch(args.id, {
      ...(args.url !== undefined ? { url: checkUrl(args.url) } : {}),
      ...(args.events !== undefined ? { events: [...args.events] } : {}),
      ...(args.active !== undefined ? { active: args.active } : {}),
    });
    return null;
  },
});

export const rotateSecret = mutation({
  args: { id: v.id("webhooks") },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    const hook = await ctx.db.get(args.id);
    if (!hook) throw new Error("Webhook not found.");
    const secret = generateWebhookSecret();
    await ctx.db.patch(args.id, { secret, failureCount: 0 });
    return { secret };
  },
});

export const remove = mutation({
  args: { id: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hook = await ctx.db.get(args.id);
    if (!hook) throw new Error("Webhook not found.");
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_webhook", (q) => q.eq("webhookId", args.id))
      .collect();
    for (const delivery of deliveries) {
      await ctx.db.delete(delivery._id);
    }
    await ctx.db.delete(args.id);
    return null;
  },
});

export const deliveries = query({
  args: {
    webhookId: v.optional(v.id("webhooks")),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(publicDelivery),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    if (args.webhookId) {
      const rows = await ctx.db
        .query("deliveries")
        .withIndex("by_webhook", (q) => q.eq("webhookId", args.webhookId!))
        .order("desc")
        .take(limit);
      return args.status ? rows.filter((r) => r.status === args.status) : rows;
    }
    const rows = await ctx.db
      .query("deliveries")
      .order("desc")
      .take(limit);
    return args.status ? rows.filter((r) => r.status === args.status) : rows;
  },
});

export const dueDeliveries = internalQuery({
  args: { limit: v.optional(v.number()), now: v.optional(v.number()) },
  returns: v.array(publicDelivery),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const now = args.now ?? Date.now();
    const rows = await ctx.db
      .query("deliveries")
      .withIndex("by_status_retry", (q) =>
        q.eq("status", "pending").lte("nextRetryAt", now),
      )
      .take(limit);
    return rows;
  },
});

export const webhookSecret = internalQuery({
  args: { id: v.id("webhooks") },
  returns: v.union(
    v.object({
      url: v.string(),
      secret: v.string(),
      active: v.boolean(),
      boardId: v.id("boards"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const hook = await ctx.db.get(args.id);
    if (!hook) return null;
    return {
      url: hook.url,
      secret: hook.secret,
      active: hook.active,
      boardId: hook.boardId,
    };
  },
});

export const recordOutcome = mutation({
  args: {
    deliveryId: v.id("deliveries"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return null;
    const now = Date.now();
    const attempts = delivery.attempts + 1;
    if (args.ok) {
      await ctx.db.patch(args.deliveryId, {
        status: "delivered",
        attempts,
        deliveredAt: now,
        lastError: undefined,
      });
      const hook = await ctx.db.get(delivery.webhookId);
      if (hook) {
        await ctx.db.patch(hook._id, { failureCount: 0, lastTriggeredAt: now });
      }
      return null;
    }
    const retryAt = nextRetryAt(attempts, now);
    if (retryAt === null) {
      await ctx.db.patch(args.deliveryId, {
        status: "failed",
        attempts,
        nextRetryAt: undefined,
        lastError: args.error ?? "delivery failed",
      });
      const hook = await ctx.db.get(delivery.webhookId);
      if (hook) {
        await ctx.db.patch(hook._id, {
          failureCount: hook.failureCount + 1,
          active: false,
          lastError: args.error ?? "delivery failed",
        });
      }
      return null;
    }
    await ctx.db.patch(args.deliveryId, {
      attempts,
      nextRetryAt: retryAt,
      lastError: args.error ?? "delivery failed",
    });
    const hook = await ctx.db.get(delivery.webhookId);
    if (hook) {
      await ctx.db.patch(hook._id, {
        failureCount: hook.failureCount + 1,
        lastError: args.error ?? "delivery failed",
      });
    }
    return null;
  },
});

/**
 * Cron/action deliverer: claim due deliveries, POST each envelope with its
 * HMAC signature, and record the outcome. At most one cron run executes at a
 * time; overlapping runs skip rather than double-deliver.
 */
export const deliverDue = action({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ attempted: v.number(), delivered: v.number() }),
  handler: async (ctx, args) => {
    const due: Doc<"deliveries">[] = await ctx.runQuery(
      internal.webhooks.dueDeliveries,
      { limit: args.limit },
    );
    let delivered = 0;
    for (const delivery of due) {
      const hook = await ctx.runQuery(internal.webhooks.webhookSecret, {
        id: delivery.webhookId,
      });
      if (!hook || !hook.active) {
        await ctx.runMutation(api.webhooks.recordOutcome, {
          deliveryId: delivery._id,
          ok: false,
          error: "webhook missing or inactive",
        });
        continue;
      }
      const board = await ctx.runQuery(internal.webhooks.boardFor, {
        boardId: hook.boardId,
      });
      const envelope = buildEnvelope({
        deliveryId: delivery._id as never,
        type: delivery.event as WebhookEventType,
        occurredAt: delivery.createdAt,
        board: board ?? { id: hook.boardId as never, slug: "", name: "" },
        data:
          typeof delivery.payload === "object" && delivery.payload !== null
            ? (delivery.payload as Record<string, unknown>)
            : {},
      });
      const body = JSON.stringify(envelope);
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Feedback-Signature": await signWebhook(hook.secret, body),
            "X-Feedback-Event": delivery.event,
            "X-Feedback-Delivery": delivery._id,
          },
          body,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await ctx.runMutation(api.webhooks.recordOutcome, {
          deliveryId: delivery._id,
          ok: true,
        });
        delivered += 1;
      } catch (error) {
        await ctx.runMutation(api.webhooks.recordOutcome, {
          deliveryId: delivery._id,
          ok: false,
          error: error instanceof Error ? error.message : "delivery failed",
        });
      }
    }
    return { attempted: due.length, delivered };
  },
});

export const boardFor = internalQuery({
  args: { boardId: v.id("boards") },
  returns: v.union(
    v.object({
      id: v.id("boards"),
      slug: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.boardId);
    if (!board) return null;
    return { id: board._id, slug: board.slug, name: board.name };
  },
});
