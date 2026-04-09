-- Fix: anon SELECT hitting authenticated-only policies can still evaluate and recurse (OR not guaranteed short-circuit)
-- Scope internal policies to authenticated; keep explicit anon policies for public signup pages.

-- sessions: internal access policy should not apply to anon
drop policy if exists sessions_select_related on public.sessions;
create policy sessions_select_related
on public.sessions
for select
to authenticated
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.auth_user_is_session_participant(id)
  or public.is_platform_admin()
);

-- session_participants: internal policy should not apply to anon
drop policy if exists session_participants_select_related on public.session_participants;
create policy session_participants_select_related
on public.session_participants
for select
to authenticated
using (
  public.user_can_access_session(session_id)
);

-- players: internal access policy should not apply to anon
drop policy if exists players_select on public.players;
create policy players_select
on public.players
for select
to authenticated
using (public.user_can_access_player(id));

