# Supabase adapter

`@userr/supabase` is the Supabase distribution of Userr's Postgres adapter. It
reuses the tested transactional repository and framework-neutral handler from
`@userr/neon`; the Supabase-specific value is its SQL migration set, browser
RLS policy, and private Realtime Broadcast helpers. It does not put a Supabase
key in generated browser code or take ownership of Supabase Auth.

## Install shape

Apply, in order, the files in `@userr/supabase/supabase/migrations/`:

1. `0000_userr_schema.sql` for tables, pgvector, trigram, and indexes.
2. `0001_userr_rls.sql` for public read, own-vote, and private Broadcast RLS.
3. `0002_userr_upgrade.sql` only adds missing Phase 7 objects, so it safely
   upgrades the original three-table preview migration.
4. `0003_userr_rls_refresh.sql` reapplies the complete policy set after that
   upgrade. It is also harmless on a fresh install.

Mount `createRequestHandler` or `toNextJsHandler` with a host-held Postgres
connection and host-owned `identify`, `resolveRole`, and `canReadBoard`
callbacks. Keep any Supabase secret/server key on that server boundary.

## Realtime

Use `createPrivateFeedbackChannel(client, boardId)`, which creates
`feedback:<boardId>` with `{ config: { private: true } }`. In the Supabase
dashboard, disable Realtime's **Allow public access** setting; private channel
RLS otherwise is not enforced.

The migration keeps `userr_realtime_memberships` server-managed. A host inserts
an opaque Supabase Auth subject in `actor_id` only after its own board-access
decision. Both read and send policies require that membership and apply only to
Broadcast messages. Membership changes take effect when the client reconnects
or presents a refreshed JWT, per Supabase's authorization model.

## Guarantees and limits

- Repository operations, transactional vote/merge behavior, outbox, and the
  domain conformance suite are supplied by `@userr/neon` and tested through
  this package against PGlite/Postgres semantics.
- `vector(1536)` plus HNSW supports the same asynchronous embedding workflow
  as the Postgres adapter. Lexical matching works if embedding work is absent.
- RLS intentionally exposes only public approved boards/items and a caller's
  own votes to browser clients. Item creation, moderation, webhooks, and
  private-board reads go through the host server handler, which remains the
  authorization boundary.
- This package does not yet generate Supabase routes through `userr add`; the
  host mounts the framework-neutral handler. CLI installation is a separate,
  adoption-gated follow-up rather than a misleading partial scaffold.

See the [Supabase Realtime authorization guide](https://supabase.com/docs/guides/realtime/authorization)
for dashboard and channel requirements.
