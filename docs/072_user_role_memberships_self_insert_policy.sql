-- 072_user_role_memberships_self_insert_policy.sql
-- Fix: RLS previously had no INSERT/UPDATE on user_role_memberships, so client useProfileSync
-- could not create the player membership row after app_user_profiles insert.
-- Run in Supabase SQL Editor. Safe to re-run.

begin;

drop policy if exists user_role_memberships_insert_self_player on public.user_role_memberships;
create policy user_role_memberships_insert_self_player
on public.user_role_memberships
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'player'
);

-- Upsert may UPDATE on conflict; restrict to own player row only.
drop policy if exists user_role_memberships_update_self_player on public.user_role_memberships;
create policy user_role_memberships_update_self_player
on public.user_role_memberships
for update
to authenticated
using (user_id = auth.uid() and role = 'player')
with check (user_id = auth.uid() and role = 'player');

commit;
