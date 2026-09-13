-- SQLite/libSQL baseline. FTS5 provides immediate lexical duplicate matching;
-- semantic/vector search is deliberately unsupported on this adapter.
pragma foreign_keys = on;
create table if not exists boards (
  id text primary key, slug text not null unique, name text not null,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  allowed_kinds text not null, status_order text not null, created_at integer not null
);
create table if not exists items (
  id text primary key, board_id text not null references boards(id), public_id text not null,
  slug text not null, title text not null, body text not null default '', normalized_title text not null,
  search_text text not null default '', kind text not null, state text not null default 'inbox',
  author_id text not null, vote_count integer not null default 0, comment_count integer not null default 0,
  labels text not null default '[]', merged_into text, moderation text not null default 'approved',
  context text, embedding_state text not null default 'disabled', created_at integer not null, updated_at integer not null
);
create table if not exists votes (item_id text not null references items(id) on delete cascade, actor_id text not null, created_at integer not null, primary key (item_id, actor_id));
create table if not exists comments (id text primary key, item_id text not null references items(id) on delete cascade, actor_id text not null, body text not null, parent_id text, created_at integer not null, updated_at integer not null, deleted_at integer);
create table if not exists events (id text primary key, item_id text not null references items(id) on delete cascade, type text not null, actor_id text, payload text not null, created_at integer not null);
create table if not exists subscriptions (item_id text not null references items(id) on delete cascade, actor_id text not null, notify_comments integer not null default 1, notify_status_changes integer not null default 1, created_at integer not null, primary key (item_id, actor_id));
create table if not exists changelog_entries (id text primary key, board_id text not null references boards(id), title text not null, slug text not null, body text not null default '', version text, linked_item_ids text not null, published_at integer, created_at integer not null);
create table if not exists roadmap_lanes (id text primary key, board_id text not null references boards(id), name text not null, states text not null, sort_order integer not null default 0);
create table if not exists webhooks (id text primary key, board_id text not null references boards(id), url text not null, secret text not null, events text not null, active integer not null default 1, failure_count integer not null default 0, last_error text, last_triggered_at integer, created_at integer not null);
create table if not exists deliveries (id text primary key, webhook_id text not null references webhooks(id) on delete cascade, event text not null, payload text not null, status text not null default 'pending', attempts integer not null default 0, next_retry_at integer, last_error text, delivered_at integer, lease_owner text, lease_expires_at integer, created_at integer not null);
create table if not exists blocked_actors (board_id text not null references boards(id), actor_id text not null, reason text, created_at integer not null, primary key (board_id, actor_id));
create index if not exists items_board_state_idx on items(board_id, state);
create index if not exists items_board_title_idx on items(board_id, normalized_title);
create index if not exists comments_item_idx on comments(item_id);
create index if not exists events_item_created_idx on events(item_id, created_at);
create index if not exists deliveries_status_retry_idx on deliveries(status, next_retry_at);
create virtual table if not exists items_fts using fts5(item_id unindexed, board_id unindexed, title, body, tokenize='unicode61');
create trigger if not exists items_fts_insert after insert on items begin insert into items_fts (item_id, board_id, title, body) values (new.id, new.board_id, new.title, new.body); end;
create trigger if not exists items_fts_update after update of title, body, board_id on items begin delete from items_fts where item_id = old.id; insert into items_fts (item_id, board_id, title, body) values (new.id, new.board_id, new.title, new.body); end;
create trigger if not exists items_fts_delete after delete on items begin delete from items_fts where item_id = old.id; end;
