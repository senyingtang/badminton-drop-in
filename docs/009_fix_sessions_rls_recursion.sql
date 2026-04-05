-- Fix: infinite recursion detected in policy for relation "sessions"
--
-- Cause: sessions_select_related reads session_participants; session_participants
-- policies call user_can_access_session(), which SELECTs sessions again → loop.
--
-- Fix: RLS helper functions that read sessions (and related tables for the same
-- check) run as SECURITY DEFINER so internal queries bypass RLS. auth.uid() still
-- reflects the invoking user.

create or replace function public.user_can_access_session(input_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = input_session_id
      and (
        s.host_user_id = auth.uid()
        or public.user_manages_venue(s.venue_id)
        or exists (
          select 1
          from public.session_participants sp
          join public.players p on p.id = sp.player_id
          where sp.session_id = s.id
            and p.auth_user_id = auth.uid()
        )
      )
  )
  or public.is_platform_admin();
$$;

create or replace function public.user_is_session_host(input_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.sessions s
    where s.id = input_session_id
      and s.host_user_id = auth.uid()
  )
  or public.is_platform_admin();
$$;

grant execute on function public.user_can_access_session(uuid) to authenticated, service_role;
grant execute on function public.user_is_session_host(uuid) to authenticated, service_role;
