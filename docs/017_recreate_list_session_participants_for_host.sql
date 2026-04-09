-- Recreate list_session_participants_for_host to include signup_note in return type
drop function if exists public.list_session_participants_for_host(uuid);

create or replace function public.list_session_participants_for_host(
  input_session_id uuid
)
returns table (
  session_participant_id uuid,
  session_id uuid,
  player_id uuid,
  source_type session_participant_source_type,
  status session_participant_status_type,
  priority_order integer,
  waitlist_order integer,
  self_level smallint,
  session_effective_level smallint,
  signup_note text,
  is_removed boolean,
  created_at timestamptz,
  player_code citext,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.user_can_access_session(input_session_id) then
    raise exception 'forbidden';
  end if;

  return query
  select
    sp.id as session_participant_id,
    sp.session_id,
    sp.player_id,
    sp.source_type,
    sp.status,
    sp.priority_order,
    sp.waitlist_order,
    sp.self_level,
    sp.session_effective_level,
    sp.signup_note,
    sp.is_removed,
    sp.created_at,
    p.player_code,
    p.display_name
  from public.session_participants sp
  join public.players p on p.id = sp.player_id
  where sp.session_id = input_session_id
    and sp.is_removed = false
  order by sp.priority_order nulls last, sp.created_at asc;
end;
$$;

grant execute on function public.list_session_participants_for_host(uuid) to authenticated, service_role;

