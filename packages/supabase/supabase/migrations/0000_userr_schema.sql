create extension if not exists vector;
create table if not exists public.boards (
  id text primary key, slug text not null unique, name text not null,
  visibility text not null default 'public', allowed_kinds jsonb not null,
  status_order jsonb not null, created_at bigint not null
);
create table if not exists public.items (
  id text primary key, board_id text not null references public.boards(id),
  public_id text not null, slug text not null, title text not null, body text not null default '',
  normalized_title text not null, search_text text not null default '', kind text not null,
  state text not null default 'inbox', author_id text not null, vote_count integer not null default 0,
  comment_count integer not null default 0, labels jsonb not null default '[]'::jsonb,
  merged_into text, context jsonb, embedding vector(1536), embedding_state text not null default 'pending',
  created_at bigint not null, updated_at bigint not null
);
create table if not exists public.votes (
  item_id text not null references public.items(id) on delete cascade,
  actor_id text not null, created_at bigint not null, primary key (item_id, actor_id)
);
