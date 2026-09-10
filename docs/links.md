# Links

This is the canonical external-reference list for Userr. Prefer official
documentation for implementation decisions; use competitor repositories only as
clean-room product research, never as copy-paste sources.

## Core platform

- [Convex components](https://docs.convex.dev/components/authoring) — package, schema isolation, generated APIs, and component boundaries.
- [Convex vector search](https://docs.convex.dev/search/vector-search) — semantic duplicate search for the Convex adapter.
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions) — asynchronous embeddings, notifications, and webhook delivery.
- [Convex component directory](https://www.convex.dev/components) — eventual registry distribution.
- [Convex helpers paginator](https://www.npmjs.com/package/convex-helpers) — required component-compatible pagination.

## Framework and UI

- [Next.js App Router](https://nextjs.org/docs/app) — first generated application target.
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) — Neon/Postgres API factory target.
- [React](https://react.dev/) — portable UI primitives.
- [shadcn/ui](https://ui.shadcn.com/) — optional copy-in page styling, never a runtime requirement.
- [Radix UI](https://www.radix-ui.com/primitives) — accessible dialog/menu/tabs primitives when needed.
- [dnd kit](https://dndkit.com/) — roadmap and triage board drag-and-drop.
- [Tiptap](https://tiptap.dev/docs) — future rich-text/changelog editor.

## Data adapters and real-time

- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) — Postgres adapter in serverless/edge environments.
- [Neon pgvector](https://neon.com/docs/ai/ai-concepts) — embeddings in Neon Postgres.
- [Drizzle PostgreSQL extensions](https://orm.drizzle.team/docs/extensions) — pgvector schema/index support.
- [Supabase Realtime](https://supabase.com/docs/guides/realtime) — Supabase live-update foundation.
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) — private-channel/RLS implementation requirements.
- [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns) — pgvector setup for the Supabase adapter.
- [pgvector](https://github.com/pgvector/pgvector) — Postgres vector search reference.

## Delivery, security, and AI

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — HMAC webhook signing in web-compatible runtimes.
- [OWASP Webhook Security Guidelines](https://cheatsheetseries.owasp.org/) — signing, replay, retry, and logging policy research.
- [OpenAI embeddings guide](https://platform.openai.com/docs/guides/embeddings) — optional bring-your-own embeddings provider.
- [Resend documentation](https://resend.com/docs) — host-owned email notification example.
- [S3 API documentation](https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html) — optional attachment/blob-storage adapter.

## Distribution and developer experience

- [npm package publishing](https://docs.npmjs.com/cli/v11/commands/npm-publish) — package release process.
- [Changesets](https://github.com/changesets/changesets) — monorepo versioning.
- [Better Auth](https://www.better-auth.com/docs) — installer, adapter, and framework-integration UX reference.

## Product research — inspect, do not copy

- [Featurebase documentation](https://help.featurebase.app/) — feature parity and workflow research.
- [Quackback](https://github.com/QuackbackIO/quackback) — AGPL-3.0; product/workflow reference only.
- [Fider](https://github.com/getfider/fider) — AGPL-3.0; moderation and canonical-post workflow reference only.
- [Formbricks](https://github.com/formbricks/formbricks) — AGPL core; survey/targeting behavior reference only.
- [LogChimp](https://github.com/logchimp/logchimp) — AGPL core; board/roadmap workflow reference only.
- [UserCue](https://github.com/Paddlewheel-Inc/usercue) — MIT; examine notices and dependencies before any reuse.
- [BugDrop](https://github.com/mean-weasel/bugdrop) — MIT; contextual capture/privacy behavior reference.
- [Reflet](https://github.com/damien-schneider/reflet) — SSPL; product reference only.
