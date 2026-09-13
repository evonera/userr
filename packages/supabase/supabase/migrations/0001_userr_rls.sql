-- Apply after the Userr Postgres schema. Host-managed identity is stored in JWT `sub`.
alter table public.boards enable row level security;
alter table public.items enable row level security;
alter table public.votes enable row level security;
create policy "public boards are readable" on public.boards for select using (visibility = 'public');
create policy "public board items are readable" on public.items for select using (exists (select 1 from public.boards b where b.id = board_id and b.visibility = 'public'));
create policy "actors only write their votes" on public.votes for all using (actor_id = auth.uid()::text) with check (actor_id = auth.uid()::text);
-- Realtime is private: hosts authorize channel membership through realtime.topic().
create policy "authenticated feedback broadcast" on realtime.messages for select to authenticated using (realtime.topic() like 'feedback:%');
