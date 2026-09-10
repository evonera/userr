# Dependencies

## @userr/core (pure TS — zero DB deps)
- `zod@4` — validators for every model + adapter I/O (matches Quackback/Formbricks discipline)
- `nanoid` — board/post URL suffixes (`board-${nanoid(10)}`, LogChimp pattern)
- `slug` (gosimple/slug equiv, e.g. `github-slugger`) — human URLs + collision retry (UserCue `toSlug`)
- dev: `typescript~5.9`, `vitest`

## @userr/convex (flagship adapter)
- `convex@^1.44` — component runtime, vector indexes, scheduler, storage
- `convex-helpers` — `paginator` + `usePaginatedQuery` (built-in paginate does not work in components)
- `convex-test` + `@edge-runtime/vm` — component tests
- `openai` (optional peer) — `text-embedding-3-small` for dedup embeddings; `RESEND_API_KEY` only in host app, never component
- peers: `react@^18||^19` (hooks only)

## @userr/neon (second adapter)
- `drizzle-orm` + `drizzle-kit` — schema + migrations (mirrors BA drizzle-adapter row-count normalization)
- `postgres` (or `@neondatabase/serverless`) — driver; `pgvector` extension required (document as hard req)
- `better-auth@^1.6` + `@prisma/adapter-pg` or Drizzle adapter — only as host-auth template (port UserCue `auth.ts/permissions.ts`), not bundled
- `zod@4` — route validation; `jose` — userToken verify if signing enabled

## @userr/react (CLI copy-in source)
- peers: `react@>=18.2`, no Tailwind dep at import time (host provides Tailwind + shadcn/ui)
- `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/*` (dialog, dropdown, tabs, tooltip)
- `framer-motion` — modals/dropdowns (UserCue toast IDs + StatusDropdown pattern)
- `react-markdown + remark-gfm + rehype-highlight`, `dompurify` — post/changelog render
- `tiptap (+starter-kit/link/mention/image/placeholder)` — admin + changelog editor (Fider/Quackback parity)
- `@dnd-kit/*` — roadmap kanban DnD; `react-hot-toast` — toasts; `javascript-time-ago` or `dayjs` — timestamps

## @userr/widget (vanilla IIFE — zero runtime deps by design)
- runtime: none (BugDrop/Reflet discipline; React is peer-only for wrapper)
- build: `esbuild` or `tsdown`, `typescript`, versioned `widget.v*.js` output
- capture: `html-to-image` or `@zumer/snapdom` (DOM→canvas, no getDisplayMedia prompt)
- dev/test: `vitest`, `@playwright/test`, `wrangler` only if Cloudflare preview used

## @userr/cli
- `cac` or `commander`, `prompts` (init wizard: backend/framework/auth/UI-style/board-path),
  `kolorist`, `execa`, `fs-extra`, `diff` (safe append/overwrite prompts like BA generate)
- templates embed: `drizzle-kit`, `convex` codegen calls (spawned, not bundled)

## site (picker + docs)
- `next` (App Router), docs via `fumadocs`/`nextra` or Mintlify MDX; `shiki` code highlight

## Shared dev / ops
- `bun@>=1.4` + `turbo@2`, `oxlint` + `eslint(@convex-dev/plugin)` + `prettier` + `husky+lint-staged`
- `docker` + `docker-compose` (Neon local via Postgres+pgvector image; mailhog for email preview)
- Host-owned services (never bundled): Neon Postgres, Resend/Postmark, S3/Convex storage, Stripe (billing only if cloud hosted later)

## Explicitly avoided
- No ORM in core/; no Next-only imports in core/convex/widget; no Tailwind inside widget bundle
  (scoped shadow-DOM CSS only); no `process.env` at module scope in Convex (read inside handlers).
