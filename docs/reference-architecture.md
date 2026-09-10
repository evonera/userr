# Reference architecture

> Detailed reference for [architecture.md](./architecture.md). Where this file
> conflicts with the root invariants (host-owned auth, domain-shaped adapters,
> asynchronous optional AI, no hosted runtime), the root wins.

## BetterAuth mapping (verified against repos/better-auth v1.7.4)

BetterAuth is a UX and process reference — installer flow, per-database packages,
schema generation, and thin framework adapters — not a contract to copy
literally. Our adapter surface is domain-shaped (`FeedbackRepository`: atomic
vote, merge, cursor list, canonical lookup, event append), because votes and
merges need storage-level atomicity that generic CRUD cannot guarantee. What we
take from BetterAuth:

| BetterAuth | Ours |
|---|---|
| Per-DB packages (`kysely-adapter`, `drizzle-adapter`, `prisma-adapter`, `mongo-adapter`) behind one factory | Per-backend packages (`@userr/convex`, future `@userr/neon`, ...) implementing `FeedbackRepository`, verified by one shared conformance suite |
| `npx auth generate --adapter drizzle --dialect postgresql` (live adapter or mock; `createSchema` wins; else per-dialect generator) | `userr generate --backend neon` → Drizzle `userr-schema.ts`; `--backend convex` → `schema.ts` fragment + mount instructions |
| `npx auth migrate` (Kysely only; refuses Prisma/Drizzle with instructions) | `userr migrate` Neon-only; Convex path instructs `convex dev` / dashboard |
| `betterAuth() → (Request) => Response`, thin per-framework adapters (`toNextJsHandler`, `toNodeHandler`, SvelteKit/TanStack/Solid, Expo client) | `toNextJsHandler(userr)` route factory for the Neon backend (Phase 2); the Convex path needs no HTTP handler (`useQuery`/`useMutation` directly); cookie-sync plugin pattern reused if sessions are needed |
| `BetterAuthPlugin {id, endpoints, middlewares, hooks.before/after, schema, migrations, rateLimit}` + standalone packages (`api-key`, `sso`, `stripe`, `mcp`) | `IntegrationAdapter {key, handle(event)}` receiving typed immutable domain events with idempotency keys; Slack/Linear/GitHub/Discord ship as plugins with `server + ui` folders + conformance tests (Quackback pattern) |

## Convex component rules (verified against Convex component docs — see `docs/links.md`)

- `defineComponent("userr")` + `app.use(userr)`; own `schema.ts`, own `_generated/server.js`; app code never imports component `_generated` except `component.js` type.
- Only public functions reachable via `ctx.runQuery/runMutation/runAction`; `Id<>` crossing the boundary becomes `string`.
- No `ctx.auth` inside component — app authenticates (`getAuthUserId`), passes `userId` explicitly.
- Env isolated: declared in `defineComponent(name, {env: {...}})`, read inside handlers only; app supplies via `app.use(comp, {env})`.
- Vector index: `defineTable({...}).vectorIndex("by_embedding", {vectorField: "embedding", dimensions: 1536, filterFields: ["boardId"]})`; searched via `ctx.vectorSearch` in actions (the runtime exposes vector search on action context, not query context).
- Pagination inside components: built-in `.paginate()` does not work — use `convex-helpers` `paginator` + `usePaginatedQuery`.
- HTTP dark by default; expose via `app.use(comp, {httpPrefix})` under `.convex.site` only for RSS/webhook ingress. Scheduler/crons/actions are component-scoped (notification fan-out, stale auto-close, embedding backfill).
- Cross-boundary callbacks via function handles (`createFunctionHandle` → `v.string()` → `ctx.runMutation/scheduler.runAfter`).
- Test via `convex-test` + `registerComponent` (or package `./test` helper); build via `convex codegen --component-dir`.

## Data model (unified — Convex tables = Drizzle tables)

```
boards: slug @unique, name, description, isPublic, url, color, logo, customDomain,
        settings{customFields, allowAnonymousVoting, requireApproval, defaultStatus/View, cardStyle},
        access matrix, timestamps
posts: boardId FK, number/uid, slug @unique, title, normalizedTitle, searchText/tsvector,
       description (markdown + TipTap JSON), status (open/under_review/planned/in_progress/completed/closed),
       statusFilter bucket {open,closed}, category (suggestion/bug/feedback/feature),
       authorId (opaque host id), assigneeId, voteCount, commentCount, pinnedAt, pinnedCommentId,
       isLocked, isApproved, moderationState, canonicalPostId (merge target), mergedAt/By,
       eta, roadmapOrder, showOnRoadmap, tags M:N, customFieldValues, messageId (Discord sync),
       embedding vector(1536), summaryJson, autoTagged, context{url,pageTitle,browser,os,device,
       viewport,screen,scroll,language,timezone,userAgent,referrer,sdkVersion,selection{selector,
       componentStack,sourceLocation,rect},consoleEvents[]}, search_vector, timestamps, deletedAt
votes: postId, userId/externalUserId, @@unique[postId,userId]
comments: postId, parentId?, authorId, body, depth, likeCount, replyCount, isOfficial,
          isPrivate (staff-only), moderationState, timestamps, deletedAt (tombstone, body null)
tags: boardId, name, slug, color, isPublic, isRoadmapLane, laneOrder
roadmaps: boardId, name, type (column|date), columns[] → post_statuses
changelogEntries: boardId, title, slug, body, version, linkedPostIds[], publishedAt/scheduledPublishAt,
                  displayDate, notifiedAt, segmentIds, viewCount, featuredImage
subscriptions: postId, userId/email, notifyComments, notifyStatusChanges
notifications: userId, type, title, link, read, channel (inApp/email)
webhooks: boardId, url, secret (encrypted), events[], boardIds[], status, failureCount, lastError
apiKeys: lookupHash @unique, label, projectId, permission (read|write|manage)
```

Indexes: `by_board_status`, `by_slug`, `by_post_user`, `by_post_parent`, normalized-title exact match,
full-text/trigram + HNSW vector index.

## Request flows

**Convex:** `<FeedbackBoard/>` → `useQuery(api.userr.listItems)` (reactive) →
mutation `create/vote/comment` → same-transaction count update → scheduler fan-out
(webhooks, notify hook). Creation never waits for embeddings: lexical duplicate
suggestions serve immediately, semantic candidates arrive via scheduled enrichment.

**Neon:** same components (SWR client variant) → `toNextJsHandler` route →
Drizzle adapter → Postgres (+pgvector) → polling/SSE refresh; `onStatusChange` hook calls
host Resend/Postmark (we scaffold, they own keys).

## Auth: don't own it, hook into it
`identify(ctx) → userId | null` at setup (Convex); Neon reuses BetterAuth
`admin plugin + guest default + createAccessControl` (port UserCue `auth.ts/permissions.ts`).
Component stores no passwords/sessions; `isModerator/trusted` resolved by host.
