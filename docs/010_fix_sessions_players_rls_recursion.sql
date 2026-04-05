-- Fix: infinite recursion on sessions (remaining path)
--
-- sessions_select_related used EXISTS (... session_participants JOIN players ...).
-- Evaluating players RLS runs "Public can view players on shared signup roster",
-- which JOINs sessions again → sessions policies → EXISTS → players → loop.
--
-- session_participants / players public policies also subquery sessions under RLS.
--
-- Fix: SECURITY DEFINER helpers that read sessions / participants / players for
-- authorization only, bypassing RLS inside the function body.

create or replace function public.auth_user_is_session_participant(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.session_participants sp
    join public.players p on p.id = sp.player_id
    where sp.session_id = p_session_id
      and p.auth_user_id = auth.uid()
  );
$$;

create or replace function public.session_is_public_signup_visible(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = p_session_id
      and s.share_signup_code is not null
      and s.allow_self_signup = true
      and s.status in (
        'draft',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished'
      )
  );
$$;

create or replace function public.player_on_public_signup_roster(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.session_participants sp
    join public.sessions s on s.id = sp.session_id
    where sp.player_id = p_player_id
      and sp.is_removed = false
      and s.share_signup_code is not null
      and s.allow_self_signup = true
      and s.status in (
        'draft',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished'
      )
  );
$$;

drop policy if exists sessions_select_related on public.sessions;
create policy sessions_select_related
on public.sessions
for select
using (
  host_user_id = auth.uid()
  or public.user_manages_venue(venue_id)
  or public.auth_user_is_session_participant(id)
  or public.is_platform_admin()
);

drop policy if exists "Public can view participants for shared signup" on public.session_participants;
create policy "Public can view participants for shared signup" on public.session_participants
  for select
  using (
    public.session_is_public_signup_visible(session_id)
    and session_participants.is_removed = false
  );

drop policy if exists "Public can view players on shared signup roster" on public.players;
create policy "Public can view players on shared signup roster" on public.players
  for select
  using (public.player_on_public_signup_roster(id));

grant execute on function public.auth_user_is_session_participant(uuid) to authenticated, anon, service_role;
grant execute on function public.session_is_public_signup_visible(uuid) to authenticated, anon, service_role;
grant execute on function public.player_on_public_signup_roster(uuid) to authenticated, anon, service_role;
