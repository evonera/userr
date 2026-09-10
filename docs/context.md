# Userr context for future agents

## What this project is

Userr is an MIT, local-first feedback toolkit: packages and a CLI install a
feedback portal, roadmap, changelog, widget, and later customer-suite modules
inside a customer’s own application and data backend. The documentation website
is only a static front door and must never receive feedback rows, database URLs,
API keys, or customer secrets.

## Current implementation state

- `@userr/core`: zero-runtime-dependency TypeScript domain types, tested rules,
  and the shared conformance suite (`runConformanceSuite`, self-validated
  against an in-memory adapter). `FeedbackRepository` now covers
  createBoard/createItem, vote/unvote, merge, and event listing.
- `@userr/convex`: complete headless reference — boards/items/comments/
  subscriptions/embeddings with cursor pagination (`convex-helpers`),
  idempotent votes, atomic merges with subscription transfer, tombstoned
  comments (depth ≤ 5), lexical duplicates, host-driven embedding enrichment,
  and host authorization wrappers. 38 tests pass via convex-test (1
  deployment-gated vector skip); `./test` register helper exported.
- `@userr/react`: provider, card, and submission-form primitives.
- `@userr/cli`: safe `init`, `doctor`, and `upgrade` skeleton; Convex + Next only.
- No Neon/Postgres, Supabase, widget, capture, roadmap/changelog, admin, webhook,
  or external integration implementation exists yet.

## Decisions that must not drift

1. Brand/scope/bin: `userr`, `@userr/*`, and `userr`.
2. Auth, authorization, email, file storage, AI keys, and CRM data belong to the
   host application. Persist only opaque actor IDs and deliberate context.
3. Core uses domain operations, not a generic CRUD adapter. Votes and merges
   must be atomic; source items remain readable after a merge.
4. AI is optional and asynchronous. Creation uses lexical matching immediately;
   no user action waits for an embedding provider and no duplicate is auto-merged.
5. Convex is the flagship implementation. Postgres/Neon is the next adapter and
   must pass the same conformance suite before cross-backend marketing.
6. Sensitive capture is opt-in only: allowlisted metadata, masking/redaction,
   explicit console-log consent, retention controls, and no session replay.
7. Keep dependencies permissive and optional where possible. Never copy source
   from AGPL/SSPL/BSL projects; see `../CONTRIBUTING.md` and `./links.md`.

## How to work

1. Read `../AGENTS.md`, this file, `./architecture.md`, `./phases.md`, and the relevant
   detailed document in this folder before changing architecture.
2. Implement one phase/PR-sized unit. Update the matching checklist and tests.
3. Run `npm run build`, `npm test`, and `npm run typecheck` before handing off.
4. Use `npm run userr -- init --dry-run` to verify CLI changes without writing.
5. Use `./links.md` for primary sources. Record any new external decision in
   the relevant spec instead of leaving it only in chat.

## Current next task

Phase 2: Postgres/Neon headless parity (Drizzle schema, transactional
vote/merge, route-handler factory) running the shared conformance suite green.

## Working agreements

- One phase = one branch = one PR (`phase-N-topic` → `main`), merged with
  rebase for linear history after CI (`verify`) is green. Direct pushes to
  `main` are only for trivial docs follow-ups.
- Shipped: PR #1 (Phase 1, merged 2026-09-10), PR #2 (exact-duplicate fix, merged 2026-09-10).

## Completed 2026-09-10 — PR #1 (Phase 1, rebased onto main)

- Component modules (boards/items/comments/subscriptions/embeddings) with
  `args`+`returns` validators on every function; cursor pagination via
  `convex-helpers`; host guards (`requireRole`/`requireModerator`/
  `assertTransitionAllowed`) backed by `@userr/core`.
- `_generated/` produced offline from the CLI's own templates (checked in, so
  tests run with no deployment); initial stub `api.ts` — `npx convex dev`
  upgrades it to fully typed bindings once authorized.
- Findings recorded for future agents: object validators reject unexpected
  fields (strip `embedding`/`deletedAt` from public views); vector search is
  action-only (`ctx.vectorSearch`, not `db.query().withVectorIndex()` in this
  SDK); convex-test implements no vector/search-syscall paths (lexical search
  works, vector test skipped as deployment-gated); `v.id` validates table
  suffix, so tests forge ghost IDs by bumping the numeric prefix.
- Verified: build, 4 core + 38 convex (+1 skip) + 1 CLI tests, typecheck clean,
  CLI dry-run green. Example host scaffold in `fixtures/next-convex`.
- CI lesson: the CLI entry lived only in gitignored `dist/` and was never
  committed, so CI's fresh checkout failed. Source now lives in
  `packages/cli/src/index.mjs` (bin + root script + test updated). Never ship
  runnable code from a gitignored path.
- Review lesson (Greptile P1 on PR #1, fixed in PR #2): never use `.unique()`
  on a deliberately non-unique index. `findSimilar` scans a bounded `.take(5)`
  set for the first non-merged exact hit; regression test covers two live
  identical titles.

## Completed 2026-09-10 — docs reconciliation (docs-only PR)

- Rewrote `./delivery-plan.md` as a subtask expansion of `./phases.md`
  (Phases 1–7); removed the stale generic-CRUD `FeedbackAdapter`, sync-embedding,
  and bun/turbo premises.
- Fixed `./reference-architecture.md`: BetterAuth is now a UX/process
  reference, not a contract copy; adapter surface documented as domain-shaped
  `FeedbackRepository`; component name `userr`; creation never waits for embeddings.
- Fixed `./adapter-matrix.md` framing (same correction) and
  `./product-spec.md` (npm workspaces; Convex-first → Neon parity sequencing).
- Verified: `npm run build`, `npm test` (3 core + 1 CLI pass), `npm run typecheck`,
  `npm run userr -- init --dry-run --backend convex --framework next` — all green.

## Open decisions (do not assume)

- CLI generates `feedback.config.ts`; rename to `userr.config.ts` for brand
  consistency? Pre-release so cheap, but needs an explicit call (touches CLI
  source, test, doctor check, and docs).

## Completed 2026-09-10 — docs consolidation + GitHub push

- Moved root spec files (`plan`, `architecture`, `features`, `dependencies`,
  `phases`, `context`) into `docs/`; root keeps `README.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, `LICENSE`. Did NOT gitignore `.md` files — docs ship with
  the repo; `docs/README.md` is now the full index. Fixed all cross-links
  (`AGENTS.md`, `README.md`, in-docs references) and verified zero stale paths.
- Extended `.gitignore` (`.DS_Store`, `*.local`, `convex/_generated/`).
- Initialized git, committed foundation (48 files), pushed `main` to
  `github.com/evonera/userr` (remote was empty; now tracks `origin/main`).
