# `@userr/convex`

Isolated Convex component for Userr. Mount it from `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import userr from "@userr/convex/convex.config.js";

const app = defineApp();
app.use(userr);
export default app;
```

Component functions are not client-public. Re-export host functions that
resolve the current actor and authorization (see `src/client/index.ts`:
`requireActor`, `requireRole`, `requireModerator`,
`assertTransitionAllowed`), then call the component through your generated
`components.userr` reference. This keeps Better Auth, Clerk, Convex Auth, or a
user table entirely in the host app. `fixtures/next-convex` shows the pattern.

## Surface

- `boards.*` — create/get/getBySlug/list (paginated).
- `items.*` — list (cursor-paginated, newest first), listTop (bounded,
  vote-ordered), get (with viewer vote/subscription flags), create, setState,
  vote/unvote (idempotent), merge (atomic vote + subscription transfer,
  canonical pointer, never deletes), findSimilar (lexical, no AI needed),
  events (paginated audit trail), recordEvent (host-defined audit events).
- `comments.*` — list (paginated, oldest first), create (reply depth ≤ 5),
  edit/remove (author or `asModerator` flag set by the host wrapper;
  removal tombstones to preserve thread shape).
- `subscriptions.*` — subscribe (idempotent flag updates), unsubscribe,
  subscribers (actor IDs for host fan-out; the component never sends mail).
- `embeddings.*` — pendingEnrichment, storeEmbedding, disableEnrichment,
  findSimilarVector (action; the host embeds with its own keys and passes
  vectors in). Creation never waits for enrichment.

## Development

```bash
npm test          # vitest + convex-test, offline
npm run typecheck # strict src, relaxed test dir (stub `api` is AnyApi)
```

`src/component/_generated` is checked in from the CLI's own templates so tests
run with no deployment. It currently holds the initial stub `api.ts`; running
`npx convex dev` once (needs explicit authorization) upgrades it to fully typed
bindings. The one deployment-gated test (`findSimilarVector`) is skipped until
then — convex-test implements neither vector indexes nor the vectorSearch
syscall.

Host enrichment recipe (keys stay in the host app): schedule a host action
that reads `pendingEnrichment`, embeds each text with your provider, and
writes back via `storeEmbedding`.
