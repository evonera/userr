# `@userr/neon`

Postgres (Neon) adapter for Userr. Implements the same shared
`FeedbackRepository` contract as `@userr/convex`, proven by the same
conformance suite — parity is claimed on tests, not inspection.

## Use (production, Neon)

```ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRepository } from "@userr/neon";
import * as schema from "@userr/neon/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const repo = createRepository(db);
```

Apply migrations with your own runner (`drizzle-kit migrate` or the host's):

```bash
npx drizzle-kit migrate --config ./drizzle.config.ts
```

Requires the `vector` and `pg_trgm` extensions (see `drizzle/0000*`); both
ship with Neon. Vector dedup is native pgvector (HNSW index in
`drizzle/0001_vector_search.sql`).

## HTTP routes (Next.js App Router)

```ts
// app/api/userr/[...path]/route.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { toNextJsHandler } from "@userr/neon/handler";
import * as schema from "@userr/neon/schema";

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL! }), {
  schema,
});

export const { GET, POST } = toNextJsHandler({
  db,
  identify: async (req) => req.headers.get("x-actor"), // your session/JWT/API key
  resolveRole: async (actorId) => (actorId === "owner" ? "owner" : "member"),
  transitions: [
    { from: "inbox", to: "open", roles: ["moderator"] },
    // ... your state machine
  ],
});
```

Identity, roles, and transitions belong to the host: `identify` resolves the
caller, `resolveRole` maps them per board, and moderator paths reject
fail-closed when role resolution is absent. Status codes follow the core rule
codes (`INVALID_TRANSITION` → 400, `PERMISSION_DENIED` → 403,
`MERGE_CONFLICT` → 409).

Reads are public; every write requires `identify` to return an actor ID.
Reactivity is polling/SWR for now — documented honestly, no live-push claims.

## Host-run enrichment

Unlike Convex actions, the Postgres path has no component scheduler. Run your
own cron/job with your own embedding keys:

```ts
import { pendingEnrichment, storeEmbedding } from "@userr/neon";

const batch = await pendingEnrichment(db, { limit: 20 });
for (const { itemId, text } of batch) {
  await storeEmbedding(db, { itemId, embedding: await embed(text) });
}
```

## Development

```bash
npm test          # vitest against PGlite (real Postgres + pgvector, in-process)
npm run typecheck
npm run db:generate  # regenerate drizzle/ after schema changes
```

Tests need no credentials: PGlite runs the committed `drizzle/` migrations,
including the vector and trigram extensions.
