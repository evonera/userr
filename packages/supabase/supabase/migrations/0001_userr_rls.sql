-- Browser clients receive this least-privilege RLS. Server-side Userr
-- handlers use a host-held database credential; Userr never owns that key.
alter table public.boards enable row level security;
alter table public.items enable row level security;
alter table public.votes enable row level security;
alter table public.comments enable row level security;
alter table public.events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.changelog_entries enable row level security;
alter table public.roadmap_lanes enable row level security;
alter table public.webhooks enable row level security;
alter table public.deliveries enable row level security;
alter table public.blocked_actors enable row level security;
alter table public.userr_realtime_memberships enable row level security;

drop policy if exists "public boards are readable" on public.boards;
drop policy if exists "public board items are readable" on public.items;
drop policy if exists "actors only write their votes" on public.votes;
drop policy if exists "members read their own realtime membership" on public.userr_realtime_memberships;
drop policy if exists "members receive private feedback broadcasts" on realtime.messages;
drop policy if exists "members send private feedback broadcasts" on realtime.messages;

create policy "public boards are readable" on public.boards for select
  using (visibility = 'public');
create policy "public board items are readable" on public.items for select
  using (moderation = 'approved' and exists (
    select 1 from public.boards b where b.id = board_id and b.visibility = 'public'
  ));
create policy "actors only write their votes" on public.votes for all to authenticated
  using (actor_id = (select auth.uid())::text)
  with check (actor_id = (select auth.uid())::text);
create policy "members read their own realtime membership"
  on public.userr_realtime_memberships for select to authenticated
  using (actor_id = (select auth.uid())::text);

-- Private Broadcast channels use feedback:<boardId>. Hosts maintain this
-- membership table through their server, never from an untrusted client.
create policy "members receive private feedback broadcasts" on realtime.messages
  for select to authenticated using (
    realtime.messages.extension = 'broadcast' and exists (
      select 1 from public.userr_realtime_memberships m
      where m.actor_id = (select auth.uid())::text
        and ('feedback:' || m.board_id) = (select realtime.topic())
    )
  );
create policy "members send private feedback broadcasts" on realtime.messages
  for insert to authenticated with check (
    realtime.messages.extension = 'broadcast' and exists (
      select 1 from public.userr_realtime_memberships m
      where m.actor_id = (select auth.uid())::text
        and ('feedback:' || m.board_id) = (select realtime.topic())
    )
  );
