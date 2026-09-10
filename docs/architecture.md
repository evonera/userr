# Architecture

## Package boundaries

| Package | Responsibility |
| --- | --- |
| `@userr/core` | Domain types, state-machine rules, merge plans, contracts |
| `@userr/convex` | Isolated Convex component and host wrapper helpers |
| `@userr/react` | Accessible primitives, theme tokens, copy-in surfaces |
| `@userr/cli` | Safe detection, dry-run, templates, doctor and upgrades |

Future `postgres`, `supabase`, `widget`, `capture`, `surveys`, and `support`
packages are independently versioned adapters/extensions, not dependencies of
the core board.

## Ownership boundary

The host resolves an `Actor`, permissions, identity metadata, email delivery,
files, AI, and integrations. The feedback backend persists opaque actor and
organization IDs and enforces decisions passed by the host wrapper. An adapter
must not inspect a host user table or assume an auth provider.

## Domain invariants

- A vote is unique per `(itemId, actorId)`.
- A merged request remains readable and points to its canonical request.
- Merge transfers support atomically and records an event; source records are
  never deleted as part of a merge.
- Status transitions are explicitly configured and audited.
- Public share links use immutable IDs, never a mutable title alone.
- Metadata is allowlisted structured context, separated from user-authored text.

## Adapter contracts

`FeedbackRepository` is intentionally domain-shaped: it owns atomic vote,
merge, cursor list, canonical lookup, and event append operations. It is not a
generic CRUD interface. Optional `EmbeddingProvider`, `BlobStore`,
`NotificationProvider`, `RealtimeAdapter`, and `IntegrationAdapter` receive
typed jobs/events and may fail independently from feedback creation.

## Data flow

1. UI obtains an actor and context from the host.
2. Host wrapper authorizes and calls an adapter mutation.
3. Adapter writes item/event atomically and schedules optional enrichment.
4. Realtime adapter invalidates or pushes affected board/detail views.
5. Outbound adapters consume an immutable domain event with idempotency key.
