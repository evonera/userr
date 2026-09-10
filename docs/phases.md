# Userr delivery phases

Each numbered phase is one pull request. A phase ships only when its listed
tests pass; later phase detail lives in [delivery-plan.md](./delivery-plan.md).

## Completed foundation

- [x] Repository contract, MIT license, package workspaces, base CI, fixtures,
  documentation, portable rules, React primitives, and safe CLI skeleton.
- [x] Domain invariants for transitions, canonical merges, cursor pages, and
  lexical fallback matching.

## Phase 1 — Convex headless reference (shipped 2026-09-10)

- [x] Component queries, cursor pagination, comments, subscriptions,
  status transitions, moderation, and host authorization wrappers.
- [x] `convex-test` coverage (38 passing, 1 deployment-gated vector skip),
  `./test` register helper, fixtures example app, host enrichment recipe.
- [x] Shared domain conformance suite defined in `@userr/core` and passing
  against both the in-memory adapter and the Convex component.
- [ ] Deployment-gated remainder: `npx convex dev` once authorized (fully typed
  `api.ts`, `findSimilarVector` live run, fixture reactivity check).
- Host functions resolve identity and permission first; component functions
  stay client-unreachable.

## Phase 2 — Postgres/Neon headless parity (shipped)

- Drizzle schema/migrations, `pgvector`, transactional vote/merge behavior,
  Next route-handler factory, and BYO auth integration points.
- The shared domain conformance suite passes against Convex and Postgres.
- Polling/SWR baseline documented honestly; no cross-backend “live” claim.

## Phase 3 — Public portal and updates (in review, unmerged)

- Generate owned Next.js board, detail, roadmap, changelog, RSS/sitemap, i18n,
  theming, comments, search, and duplicate suggestions.
- Extend CLI with `add`, generated-file ownership markers, and non-overwriting
  upgrades for Convex and Neon.

## Phase 4 — Triage and closed loop

- Add inbox, moderation, bulk actions, keyboard workflow, merge review, roadmap
  board, prioritization, changelog publishing, subscriptions, and host email hooks.
- Implement the generic signed webhook outbox and deliveries ledger first.

## Phase 5 — Contextual widget and capture

- Ship a zero-runtime-dependency browser launcher/SDK and React wrapper.
- Add opt-in screenshots, annotation, redaction/masking, element context, consent,
  metadata allowlists, and browser E2E/privacy tests.

## Phase 6 — Intelligence, integrations, and site

- Add asynchronous BYO embeddings, semantic candidates, admin-reviewed merging,
  summaries, and provider-failure fallbacks.
- Build generic webhooks, then Slack, Discord, GitHub, and Linear plugins.
- Publish static docs/stack picker only; it never receives customer data or secrets.

## Phase 7 — Demand-gated extensions

- Supabase adapter with RLS/private Broadcast, then SQLite/MySQL only with their
  documented vector/realtime fallback behavior.
- Surveys/outbound, help center/support, MCP, mobile SDKs, importers, multi-brand,
  custom domains, RTL, and plugin SDK follow real adoption signals.
