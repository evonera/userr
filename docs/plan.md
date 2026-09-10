# Userr product plan

## Promise

Userr gives a product team a feedback portal, embedded capture,
triage workflow, roadmap, changelog, and eventually support tooling without
introducing a feedback SaaS or a second customer database. Customers own their
schemas, UI source, credentials, delivery infrastructure, and deployment.

## Reference release

The first production release targets Convex and Next.js. It provides real-time
boards, private/public visibility, host-controlled identity, posts, votes,
comments, moderation, merge-safe canonical requests, and generated React
routes. Semantic search is an optional asynchronous enhancement, never a
creation-time dependency.

## Non-goals

- No hidden hosted control plane, analytics beacon, or vendor data proxy.
- No session replay in the capture module.
- No automatic destructive duplicate merge.
- No cross-backend claim until that adapter passes the shared contract suite.

## Product decisions

- License: MIT.
- AI: bring a provider and key, or supply a custom provider implementation.
- Notifications, storage, and integrations: host-owned adapters.
- UI: source-copyable pages plus stable composable React primitives.
- Authorization: resolved by the host, never by this package.
