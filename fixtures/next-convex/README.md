# next-convex fixture (example app)

Minimal Convex + Next.js host showing the canonical Userr integration. This is
a scaffold: bindings under `convex/_generated` are produced by a real
deployment, which needs explicit authorization (see `docs/context.md`).

## Once a dev deployment is authorized

```bash
cd fixtures/next-convex
npx convex dev        # generates convex/_generated, runs codegen for userr
npx convex run convex/feedback.ts:seed
```

Then verify the deployment-gated cases:

- `embeddings.findSimilarVector` (vector search; convex-test cannot run it)
- `items.list` reactivity in the Next.js app (`app/feedback/page.tsx` renders
  `<FeedbackProvider>` from `@userr/react` wired to `api.convex/feedback`)

## What the fixture proves without a deployment

Nothing runs here yet — but every function it calls is covered offline by
`packages/convex/test` via convex-test (38 passing, 1 deployment-gated skip).
