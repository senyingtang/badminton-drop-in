-- Host action: move a participant to waitlist and place at the end
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
  v_new_order integer;
  v_venue_id uuid;
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

  select venue_id into v_venue_id from public.sessions where id = v_sp.session_id;

  if not (
    public.user_is_session_host(v_sp.session_id)
    or public.user_manages_venue(v_venue_id)
    or public.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if v_sp.is_removed = true then
    raise exception 'already_removed';
  end if;

  if v_sp.status = 'waitlist' then
    -- already waitlist, no-op
    return;
  end if;

  if v_sp.status not in ('confirmed_main','promoted_from_waitlist','pending') then
    raise exception 'unsupported_status';
  end if;

  select coalesce(max(waitlist_order), 0) + 1
    into v_new_order
  from public.session_participants
  where session_id = v_sp.session_id
    and status = 'waitlist'
    and is_removed = false;

  update public.session_participants
  set
    status = 'waitlist',
    waitlist_order = v_new_order,
    updated_at = now()
  where id = input_session_participant_id;
end;
$$;

grant execute on function public.host_move_participant_to_waitlist(uuid) to authenticated, service_role;

