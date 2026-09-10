# Userr agent instructions

## Orientation

Start with [docs/context.md](./docs/context.md), then [docs/architecture.md](./docs/architecture.md)
and [docs/phases.md](./docs/phases.md). Detailed specifications are indexed in
[docs/README.md](./docs/README.md). Treat these files as the durable project
memory; update them when a material product or architecture decision changes.

## Scope and quality bar

- Build a local-first developer product, not a hosted feedback SaaS.
- Keep core portable and dependency-light. No framework, ORM, environment, or
  database driver imports in `packages/core`.
- Keep identity, permission policy, providers, credentials, and customer data in
  the host app. Component/backend APIs take opaque actor IDs at their boundary.
- Never block post creation on embeddings, webhooks, notifications, storage, or
  integrations. Schedule optional work and make failures observable.
- Protect merge, vote, and notification idempotency with storage-level atomicity.
- Do not claim a backend adapter or feature is complete without tests.

## Security and legal constraints

- Do not copy code, tests, assets, or text from AGPL/SSPL/BSL references. They
  are behavior research only. Follow `CONTRIBUTING.md`.
- Treat capture/attachments/console logs as sensitive. Require explicit opt-in,
  metadata allowlisting, redaction, retention controls, and safe logging.
- Webhooks use versioned events, HMAC verification, idempotency keys, async
  delivery, bounded retries, and redacted logs. Follow `docs/webhook-protocol.md`.

## Repository rules

- Package scope is `@userr/*`; command is `userr`. Do not reintroduce the old
  `local-feedback` name.
- Generated CLI output is customer-owned: never overwrite a non-identical file.
  Preserve `--dry-run`, manifest, doctor, and upgrade behavior.
- Make narrow, phase-scoped changes. Do not build demand-gated adapters or the
  support suite speculatively.
- Prefer official sources listed in `docs/links.md`; document new dependencies
  in `docs/dependencies.md` and `docs/dependency-catalog.md`.

## Verification

Run before handoff:

```bash
npm run build
npm test
npm run typecheck
npm run userr -- init --dry-run --backend convex --framework next
```

If Convex component code changes, generate bindings and run component tests in a
configured example deployment. Do not create or attach a user deployment unless
explicitly authorized.
