# Dependency policy

## Core

`@userr/core` has no runtime dependency. This keeps rules portable and
testable in every adapter.

## Placement rule (decided audit-round-1)

- Code a package imports **at runtime** lives in `dependencies`, so consumers
  always receive it transitively. Examples: `convex-helpers` (paginator used
  by shipped component code), `drizzle-orm` (query builders used by
  `@userr/neon`), UI libraries (`clsx`, `tailwind-merge`, Radix primitives,
  `react-markdown`).
- Runtimes the **host provides** are `peerDependencies`: `convex` (component
  host), `pg` (the host's connection pool), `react`/`react-dom`. Peers that
  only some consumers need are marked optional via `peerDependenciesMeta`
  (`convex` for `@userr/react` — only the `/convex` subpath needs it).
- Consequently `drizzle-orm` is intentionally **not** a peer of `@userr/neon`
  (we import its runtime values; the host's copy would be a duplicate), while
  `pg` **is** a peer (we never import it; the host constructs the pool).
- Test-only packages (`convex-test`, `vitest`, PGlite, `drizzle-kit`) stay in
  `devDependencies`. Never ship runnable code from a gitignored path
  (`dist/`): package entry points must resolve to committed sources.

## Per-package notes

- Convex: `convex` (peer + dev), `convex-helpers` (dependency).
- React: `react`, `react-dom` (peers); UI ships no CSS — utility classes in
  `className` strings are styled by the host's Tailwind setup and degrade to
  unstyled-but-functional without it. Never import `tailwindcss` itself.
- Next.js installer: `next` only when generated routes are selected.
- Postgres: Drizzle plus the customer's database driver and `pgvector`.
- Supabase: `@supabase/supabase-js` and SQL migrations/RLS policies.
- Capture: browser-only image/annotation libraries, loaded on demand.

## Rules

- Prefer MIT/ISC/Apache-2.0/BSD dependencies.
- Run license, bundle-size, and vulnerability checks in CI.
- Keep provider SDKs as optional peer dependencies.
- Never introduce analytics or telemetry without explicit opt-in.
