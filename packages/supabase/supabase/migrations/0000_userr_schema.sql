-- Fresh-install schema. 0002 upgrades the early three-table preview schema.
create extension if not exists vector;
create extension if not exists pg_trgm;

create table if not exists public.boards (
  id text primary key, slug text not null unique, name text not null,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  allowed_kinds jsonb not null, status_order jsonb not null, created_at bigint not null
);
create table if not exists public.items (
  id text primary key, board_id text not null references public.boards(id),
  public_id text not null, slug text not null, title text not null, body text not null default '',
  normalized_title text not null, search_text text not null default '',
  kind text not null check (kind in ('idea', 'bug', 'feedback', 'support')),
  state text not null default 'inbox', author_id text not null,
  vote_count integer not null default 0, comment_count integer not null default 0,
  labels jsonb not null default '[]'::jsonb, merged_into text,
  moderation text not null default 'approved' check (moderation in ('approved', 'pending', 'rejected', 'spam')),
  context jsonb, embedding vector(1536),
  embedding_state text not null default 'pending' check (embedding_state in ('pending', 'ready', 'disabled', 'failed')),
  created_at bigint not null, updated_at bigint not null
);
create table if not exists public.votes (
  item_id text not null references public.items(id) on delete cascade, actor_id text not null,
  created_at bigint not null, primary key (item_id, actor_id)
);
create table if not exists public.comments (
  id text primary key, item_id text not null references public.items(id) on delete cascade,
  actor_id text not null, body text not null, parent_id text, created_at bigint not null,
  updated_at bigint not null, deleted_at bigint
);
create table if not exists public.events (
  id text primary key, item_id text not null references public.items(id) on delete cascade,
  type text not null, actor_id text, payload jsonb not null, created_at bigint not null
);
create table if not exists public.subscriptions (
  item_id text not null references public.items(id) on delete cascade, actor_id text not null,
  notify_comments boolean not null default true, notify_status_changes boolean not null default true,
  created_at bigint not null, primary key (item_id, actor_id)
);
create table if not exists public.changelog_entries (
  id text primary key, board_id text not null references public.boards(id), title text not null,
  slug text not null, body text not null default '', version text, linked_item_ids jsonb not null,
  published_at bigint, created_at bigint not null
);
create table if not exists public.roadmap_lanes (
  id text primary key, board_id text not null references public.boards(id), name text not null,
  states jsonb not null, sort_order integer not null default 0
);
create table if not exists public.webhooks (
  id text primary key, board_id text not null references public.boards(id), url text not null,
  secret text not null, events jsonb not null, active boolean not null default true,
  failure_count integer not null default 0, last_error text, last_triggered_at bigint,
  created_at bigint not null
);
create table if not exists public.deliveries (
  id text primary key, webhook_id text not null references public.webhooks(id) on delete cascade,
  event text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0, next_retry_at bigint, last_error text, delivered_at bigint,
  lease_owner text, lease_expires_at bigint, created_at bigint not null
);
create table if not exists public.blocked_actors (
  board_id text not null references public.boards(id), actor_id text not null, reason text,
  created_at bigint not null, primary key (board_id, actor_id)
);
-- Host-maintained opaque auth-subject membership for private Broadcast access.
create table if not exists public.userr_realtime_memberships (
  board_id text not null references public.boards(id) on delete cascade, actor_id text not null,
  created_at bigint not null, primary key (board_id, actor_id)
);

create index if not exists items_board_state_idx on public.items(board_id, state);
create index if not exists items_board_title_idx on public.items(board_id, normalized_title);
create index if not exists items_merged_into_idx on public.items(merged_into);
create index if not exists items_embedding_hnsw_idx on public.items using hnsw (embedding vector_cosine_ops);
create index if not exists items_title_trgm_idx on public.items using gin (normalized_title gin_trgm_ops);
create index if not exists comments_item_idx on public.comments(item_id);
create index if not exists events_item_created_idx on public.events(item_id, created_at);
create index if not exists changelog_board_created_idx on public.changelog_entries(board_id, created_at);
create index if not exists lanes_board_order_idx on public.roadmap_lanes(board_id, sort_order);
create index if not exists webhooks_board_idx on public.webhooks(board_id);
create index if not exists deliveries_webhook_idx on public.deliveries(webhook_id);
create index if not exists deliveries_status_retry_idx on public.deliveries(status, next_retry_at);
