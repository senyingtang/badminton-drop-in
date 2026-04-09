-- Move a participant to waitlist with correct ordering (host/admin only)
create or replace function public.host_move_participant_to_waitlist(
  input_session_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.session_participants%rowtype;
  v_session public.sessions%rowtype;
  v_next_order integer;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select * into v_sp
  from public.session_participants
  where id = input_session_participant_id
  for update;

  if not found then
    raise exception 'session participant not found';
  end if;

  select * into v_session
  from public.sessions
  where id = v_sp.session_id;

  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_is_session_host(v_sp.session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  if v_sp.is_removed = true then
    raise exception 'participant_removed';
  end if;

  if v_sp.status not in ('confirmed_main', 'promoted_from_waitlist') then
    raise exception 'not_main_list';
  end if;

  select coalesce(max(waitlist_order), 0) + 1 into v_next_order
  from public.session_participants
  where session_id = v_sp.session_id
    and is_removed = false
    and status = 'waitlist';

  update public.session_participants
  set status = 'waitlist',
      waitlist_order = v_next_order,
      updated_at = now()
  where id = input_session_participant_id;

  insert into public.session_events (
    session_id,
    actor_user_id,
    event_type,
    payload
  ) values (
    v_sp.session_id,
    auth.uid(),
    'participant_moved_to_waitlist',
    jsonb_build_object(
      'session_participant_id', input_session_participant_id,
      'waitlist_order', v_next_order
    )
  );
end;
$$;

grant execute on function public.host_move_participant_to_waitlist(uuid) to authenticated, service_role;

