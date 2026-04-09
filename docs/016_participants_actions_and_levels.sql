-- Grants for existing RPCs used by host UI
grant execute on function public.confirm_participant_status(uuid, session_participant_status_type, uuid) to authenticated, service_role;
grant execute on function public.promote_next_waitlist_participant(uuid, uuid, uuid, text) to authenticated, service_role;

-- Backward-compatible wrapper used by UI: promote next waitlist participant with defaults
create or replace function public.promote_next_waitlist_participant_simple(
  input_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.promote_next_waitlist_participant(
    input_session_id,
    null,
    auth.uid(),
    'host_promote_next'
  );
end;
$$;

grant execute on function public.promote_next_waitlist_participant_simple(uuid) to authenticated, service_role;

-- Ensure guest signup writes a usable level for engine/host views
create or replace function public.signup_via_share_code(
  p_share_code text,
  p_display_name text,
  p_self_level smallint default 6,
  p_signup_note text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_player_id uuid;
  v_code citext;
  v_active_count integer;
  v_cap integer;
  v_status public.session_participant_status_type;
  v_waitlist_order integer;
begin
  if p_share_code is null or length(trim(p_share_code)) < 1 then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  select * into v_session
  from public.sessions
  where share_signup_code = trim(p_share_code)
    and allow_self_signup = true
    and status in (
      'draft',
      'pending_confirmation',
      'ready_for_assignment',
      'assigned',
      'in_progress',
      'round_finished'
    );

  if not found then
    raise exception 'session_not_found_or_closed' using errcode = 'P0001';
  end if;

  p_display_name := trim(p_display_name);
  if length(p_display_name) < 1 or length(p_display_name) > 100 then
    raise exception 'invalid_display_name' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.session_participants sp
    join public.players p on p.id = sp.player_id
    where sp.session_id = v_session.id
      and sp.is_removed = false
      and sp.status <> 'cancelled'
      and lower(trim(p.display_name)) = lower(p_display_name)
  ) then
    raise exception 'duplicate_name' using errcode = 'P0001';
  end if;

  if p_self_level is null or not public.is_valid_level(p_self_level) then
    p_self_level := 6;
  end if;

  v_code := ('g' || replace(gen_random_uuid()::text, '-', ''))::citext;

  insert into public.players (
    auth_user_id,
    player_code,
    display_name,
    handedness,
    gender
  )
  values (
    null,
    v_code,
    p_display_name,
    'unknown',
    'prefer_not_to_say'
  )
  returning id into v_player_id;

  select count(*)::integer into v_active_count
  from public.session_participants
  where session_id = v_session.id
    and is_removed = false
    and status in ('confirmed_main', 'promoted_from_waitlist');

  v_cap := v_session.max_participants;

  if v_cap is not null and v_cap > 0 and v_active_count >= v_cap then
    v_status := 'waitlist';
    select coalesce(max(waitlist_order), 0) + 1 into v_waitlist_order
    from public.session_participants
    where session_id = v_session.id
      and status = 'waitlist';
  else
    v_status := 'confirmed_main';
    v_waitlist_order := null;
  end if;

  insert into public.session_participants (
    session_id,
    player_id,
    source_type,
    status,
    waitlist_order,
    self_level,
    session_effective_level,
    signup_note,
    is_removed
  )
  values (
    v_session.id,
    v_player_id,
    'self_signup',
    v_status,
    v_waitlist_order,
    p_self_level,
    p_self_level,
    nullif(trim(p_signup_note), ''),
    false
  );

  return json_build_object(
    'ok', true,
    'status', v_status,
    'waitlist_order', v_waitlist_order,
    'display_name', p_display_name
  );
end;
$$;

grant execute on function public.signup_via_share_code(text, text, smallint, text) to anon, authenticated, service_role;

-- Host can adjust waitlist order
create or replace function public.host_set_waitlist_order(
  input_session_participant_id uuid,
  input_new_order integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.session_participants%rowtype;
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

  if not public.user_is_session_host(v_sp.session_id) and not public.user_manages_venue((select venue_id from public.sessions where id = v_sp.session_id)) and not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if v_sp.status <> 'waitlist' then
    raise exception 'not_waitlist';
  end if;

  if input_new_order is null or input_new_order < 1 then
    raise exception 'invalid_order';
  end if;

  update public.session_participants
  set waitlist_order = input_new_order,
      updated_at = now()
  where id = input_session_participant_id;
end;
$$;

grant execute on function public.host_set_waitlist_order(uuid, integer) to authenticated, service_role;

