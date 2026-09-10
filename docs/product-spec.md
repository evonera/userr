# Userr — BetterAuth for Feedback

## Goal
A website where a user picks their stack (Convex, Neon/Postgres, Supabase later) +
framework (Next.js first) and gets a single CLI command (`npx @userr/cli init`)
that scaffolds feedback inside their own app and DB. No hosted service. No monthly
subscription. They own data, schema, and UI code.

Inspired by BetterAuth: bring-your-own-DB library, adapter interface, CLI schema
generation, framework handler factories — applied to feedback/roadmap/changelog.

## Locked decisions
- **Backends:** Convex flagship first (Phase 1), Neon/Postgres parity immediately after
  (Phase 2) via the shared conformance suite. Supabase/SQLite are demand-gated
  (Phase 7). No cross-backend claim until an adapter passes the suite.
- **UI distribution:** copy-in via CLI (shadcn-style, owned code). No iframe portal v1.
- **Widget v1:** feedback + bug capture (floating launcher, screenshot/annotate/mask,
  console logs, element context). Full portal widget later.
- **Quality bar:** must match Featurebase public UX + beat Canny on admin triage
  (inbox, vector merge suggestions, changelog voter notifications).

## Non-goals for v1
Supabase/SQLite adapters, tickets/shared-inbox suite, status-page product,
KB/help-center, native mobile SDKs, MCP server, AI agent (beyond dedup/embeddings).

## Monorepo shape (npm workspaces)
```
@userr/core          pure TS: status machine, merge rules, dedup scoring, notify triggers
@userr/convex        real Convex component (schema, vectorIndex, queries/mutations/actions)
@userr/neon          Drizzle schema + Next.js route-handler factory + pgvector queries
@userr/react         source for CLI copy-in (board, detail, roadmap, changelog, admin)
@userr/widget        vanilla IIFE capture widget + thin React wrapper
@userr/cli           init / add / generate / migrate commands + templates
site/               static stack picker + docs (outputs one CLI command)
```

## Success criteria
1. `npx convex add @userr/convex` works in a fresh Convex app; votes/status/comments
   update live with zero polling.
2. `npx @userr/cli init` with Neon produces a working `/feedback`, `/roadmap`,
   `/changelog`, `/admin/feedback` in a fresh Next.js app backed by the user's Neon DB.
3. Admin triage (inbox + merge + bulk + changelog publish + voter notify hook) is good
   enough that a team does not go back to Canny within 6 months.
4. `core/` has zero DB imports; both adapters pass the same headless conformance tests.

## Risks
- **Adapter interface wrong on first try.** Mitigation: Convex reference first, Neon
  implemented against the proven interface, conformance suite shared; keep business
  logic in pure functions.
- **Reactivity asymmetry** (Convex live vs Neon polling/SSE). Mitigation: document
  honestly, ship SSE upgrade path, never fake parity.
- **Admin UI quality.** Mitigation: copy-in defaults must look like a real product on
  day one (shadcn + dark theme + toasts + kanban DnD), not a CRUD table.
