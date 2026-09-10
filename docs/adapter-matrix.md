# Adapters — full landscape, ranked by popularity

How BetterAuth does it (verified in `repos/better-auth`): 5 DB packages —
`kysely-adapter` (pg/mysql/sqlite + bun/node/D1 dialects), `drizzle-adapter`
(pg/mysql/sqlite), `prisma-adapter` (sqlite/cockroach/mysql/pg/sqlserver/mongo),
`mongo-adapter` (native, `id ↔ _id` mapping), `memory-adapter` (default/tests) —
all behind one factory so product code never touches a driver. CLI `generate`
emits Prisma/Drizzle/Kysely schema; `migrate` is Kysely-only. We borrow the
packaging and installer shape (one package per backend, schema generation per
backend), but our contract is domain-shaped — `FeedbackRepository` with atomic
vote/merge/cursor-list/canonical-lookup/event-append operations — not BetterAuth's
generic CRUD, which cannot guarantee vote/merge atomicity. Every adapter proves
itself against the shared conformance suite.

Popularity grounding (2026): StackOverflow — Postgres 55.6% (#1 used/admired/desired,
3:1 over MySQL for new projects), MySQL 40.5%, SQLite rising (+21%), MongoDB ~25%;
DB-Engines top = Oracle/MySQL/MSSQL/Postgres (enterprise revenue, less relevant to our
Next.js/SaaS audience); Supabase is the fastest-rising Postgres platform. pgvector only
exists properly on Postgres — dedup quality drops everywhere else.

## Tier 0 — v1 (locked)
| # | Adapter | Package | Why now |
|---|---|---|---|
| 1 | **Convex** | `@userr/convex` | Flagship. Component registry distribution, live reactivity free, vector index built-in. Niche overall but 100% of our first users. |
| 2 | **Neon / generic Postgres (Drizzle)** | `@userr/neon` | Covers Postgres/Neon/Supabase-self-managed/Vercel-Postgres in one Drizzle package. Largest audience (55.6%). pgvector native. |

## Tier 1 — next, in order (P1)
| # | Adapter | Notes | Effort |
|---|---|---|---|
| 3 | **Supabase** | Same Postgres tables, but adds RLS policies + Realtime channel (`postgres_changes`) for live votes (only non-Convex backend with true push) + `supabase/migrations/*.sql` emit + `supabase.auth.getUser()` identify. Biggest "does it work with my stack" ask after Neon. | M (mostly Neon reuse + RLS/Realtime templates) |
| 4 | **Prisma-generic Postgres** | Same SQL as Neon, different ORM client (`prisma-adapter`-style). Needed because ~half the Next.js world is Prisma, not Drizzle. CLI `--orm prisma|drizzle` switch. | S (schema already exists, client wrapper only) |
| 5 | **Turso / SQLite (Drizzle)** | libSQL edge/local, offline-capable, cheap. No pgvector → dedup falls back to trigram + normalizedTitle exact (document honestly). Big with indie/edge crowd. | M (vector fallback + migration dialect) |
| 6 | **PlanetScale / MySQL (Drizzle)** | MySQL 40.5% can't be ignored; PlanetScale = serverless MySQL. No pgvector → same fallback as SQLite. Vitess branching quirks for migrations. | M |

## Tier 2 — on demand (P2)
| # | Adapter | Notes |
|---|---|---|
| 7 | **MongoDB (native)** | BA has a native adapter; feedback maps fine to documents (post+comments embed option) but vector = Atlas Vector Search (paid tier), so dedup story weakens. Only if users ask. |
| 8 | **Cloudflare D1 (Kysely/SQLite)** | Workers/edge audience; same SQLite fallback; KV rate-limit pattern already proven by BugDrop. |
| 9 | **Firebase Firestore** | Requested by mobile/indie devs occasionally; realtime free, but queries/vector weak. Community-contribution candidate. |
| 10 | **MSSQL / SQL Server (Prisma)** | Enterprise ask only (Entra/SSO shops). Prisma provider exists; never build speculatively. |
| 11 | **CockroachDB** | Prisma provider exists; serverless Postgres-compatible; niche. |
| 12 | **In-memory** | BA has `memory-adapter` as default/tests. Ours: test/dev conformance harness + Storybook/demo mode, not production. |

## Rule
Never build Tier 2 speculatively. Signal-gated: 3+ real user asks or one maintainer
dogfoods it. Every new adapter must pass the shared conformance suite (defined in
Phase 1, extended in Phase 2) before it ships, and must document its reactivity story
(live/polling/SSE) and vector story (native/fallback/none) up front — no fake parity.
