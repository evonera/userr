# Dependency policy

## Core

`@userr/core` has no runtime dependency. This keeps rules portable and
testable in every adapter.

## Initial optional peers

- Convex: `convex`, `convex-helpers` for component pagination.
- React: `react`, `react-dom`; UI must not require Tailwind.
- Next.js installer: `next` only when generated routes are selected.

## Adapter-specific dependencies

- Postgres: Drizzle plus the customer's database driver and `pgvector`.
- Supabase: `@supabase/supabase-js` and SQL migrations/RLS policies.
- Capture: browser-only image/annotation libraries, loaded on demand.

## Rules

- Prefer MIT/ISC/Apache-2.0/BSD dependencies.
- Run license, bundle-size, and vulnerability checks in CI.
- Keep provider SDKs as optional peer dependencies.
- Never introduce analytics or telemetry without explicit opt-in.
