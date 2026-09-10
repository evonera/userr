# Userr context for future agents

## What this project is

Userr is an MIT, local-first feedback toolkit: packages and a CLI install a
feedback portal, roadmap, changelog, widget, and later customer-suite modules
inside a customer’s own application and data backend. The documentation website
is only a static front door and must never receive feedback rows, database URLs,
API keys, or customer secrets.

## Current implementation state

- `@userr/core`: zero-runtime-dependency TypeScript domain types and tested rules.
- `@userr/convex`: early component schema/mutations; requires a real Convex app
  to generate bindings, so do not claim it is published or fully integrated.
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

Finish Phase 1: implement a complete host-wrapped Convex component with
component-safe pagination, typed queries/mutations, comments/subscriptions,
state authorization, async embedding hook, and component tests/example app.

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
