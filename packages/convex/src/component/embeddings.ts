import { v } from "convex/values";

import { EMBEDDING_DIMENSIONS } from "@userr/core";
import {
  action,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { publicItem, toPublicItem } from "./model.js";

/**
 * Async embedding enrichment without blocking creation.
 *
 * The component never holds provider credentials. The host application runs
 * its own scheduled job with its own keys:
 *
 *   1. `pendingEnrichment` → items awaiting embeddings,
 *   2. embed the text with the host's provider,
 *   3. `storeEmbedding` → vectors land back in the component.
 *
 * Until enrichment runs, `items.findSimilar` serves lexical suggestions, so
 * duplicate deflection works with zero AI configuration.
 */
export const pendingEnrichment = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      itemId: v.id("items"),
      text: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const pending = await ctx.db
      .query("items")
      .filter((q) => q.eq(q.field("embeddingState"), "pending"))
      .take(limit);
    return pending.map((item) => ({
      itemId: item._id,
      text: `${item.title}\n${item.body}`,
    }));
  },
});

/** Store host-computed embeddings. Gated by the host wrapper: component
 *  functions are only reachable through app code, never directly by clients. */
export const storeEmbedding = mutation({
  args: { itemId: v.id("items"), embedding: v.array(v.float64()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.embedding.length === 0) {
      throw new Error("Embedding must not be empty.");
    }
    if (args.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${args.embedding.length}.`,
      );
    }
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Feedback item not found.");
    await ctx.db.patch(args.itemId, {
      embedding: args.embedding,
      embeddingState: "ready",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const disableEnrichment = mutation({
  args: { itemId: v.id("items") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Feedback item not found.");
    await ctx.db.patch(args.itemId, {
      embedding: undefined,
      embeddingState: "disabled",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Vector duplicate candidates. The host computes the query embedding with its
 * own provider and passes the vector in — the component only searches.
 *
 * Implemented as an action because the Convex runtime exposes vector search
 * on action context (`ctx.vectorSearch`), not on query context.
 */
export const findSimilarVector = action({
  args: {
    boardId: v.id("boards"),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.id("items"),
      title: v.string(),
      voteCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
    const hits = await ctx.vectorSearch("items", "by_embedding", {
      vector: args.embedding,
      limit: limit * 2,
      filter: (q) => q.eq("boardId", args.boardId),
    });
    const docs = (await ctx.runQuery(internal.embeddings.getByIds, {
      ids: hits.map((hit) => hit._id),
    })) as ({ _id: Id<"items">; title: string; voteCount: number; mergedInto?: Id<"items"> } | null)[];
    return docs
      .filter((doc) => doc !== null && !doc.mergedInto)
      .slice(0, limit)
      .map((doc) => ({
        id: doc!._id,
        title: doc!.title,
        voteCount: doc!.voteCount,
      }));
  },
});

export const getByIds = internalQuery({
  args: { ids: v.array(v.id("items")) },
  returns: v.array(v.union(publicItem, v.null())),
  handler: async (ctx, args) => {
    const docs: (Omit<Doc<"items">, "embedding"> | null)[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      docs.push(doc ? toPublicItem(doc) : null);
    }
    return docs;
  },
});
