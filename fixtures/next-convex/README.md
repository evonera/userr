# next-convex fixture (example backend)

Minimal Convex host showing the canonical Userr integration: component mount,
host wrappers with role/transition config, and a seed script. This is a
backend-only scaffold — there is no Next.js `app/` dir here yet (a full
portal page is queued behind a deployment); bindings under `convex/_generated`
are produced by a real deployment, which needs explicit authorization
(see `docs/context.md`).

The checked-in `resolveActorId` returns null on purpose: authenticated
mutations (`createItem`, `setItemState`) reject until real auth is wired.
Public reads (`listItems`) work once deployed. `resolveRole` currently maps
everyone to `member`, so moderation paths reject until roles come from your
user store.

## Once a dev deployment is authorized

```bash
cd fixtures/next-convex
npx convex dev        # generates convex/_generated, runs codegen for userr
npx convex run convex/feedback.ts:seed
```

Then verify the deployment-gated cases:

- `embeddings.findSimilarVector` (vector search; convex-test cannot run it)
- `items.list` reactivity from a real client

## What the fixture proves without a deployment

Nothing runs here yet — but every function it calls is covered offline by
`packages/convex/test` via convex-test (only the vector search case is
deployment-gated).
