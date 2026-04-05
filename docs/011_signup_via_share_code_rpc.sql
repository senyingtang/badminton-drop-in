-- 匿名／未登入者透過 share code 報名：單一 RPC 略過 RLS 寫入 players + session_participants

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
