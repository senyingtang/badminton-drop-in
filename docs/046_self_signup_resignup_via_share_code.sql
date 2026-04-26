-- 046: 已報名後取消 -> 允許再次報名（避免 unique(session_id, player_id) 造成矛盾）
--
-- 問題：
-- - 前台分享報名頁（登入後）直接 insert session_participants
-- - host 取消報名時僅把 status 設為 cancelled（不會刪 row）
-- - session_participants 有 unique(session_id, player_id)
-- => 玩家被取消後名單已不顯示自己，但再次報名 insert 會撞 unique 而失敗
--
-- 解法：
-- - 提供 security definer RPC：若已存在舊報名記錄且狀態允許（cancelled/pending/waitlist），則「復活」該 row
-- - 否則正常插入新 row

create or replace function public.self_signup_to_session_by_share_code(
  p_share_code text,
  p_self_level smallint default 6,
  p_signup_note text default null,
  p_session_display_name text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_player public.players%rowtype;
  v_sp public.session_participants%rowtype;
  v_active_count integer;
  v_cap integer;
  v_new_status public.session_participant_status_type;
  v_waitlist_order integer;
  v_trim_name text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if p_share_code is null or length(btrim(p_share_code)) < 1 then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  select * into v_session
  from public.sessions
  where lower(btrim(share_signup_code)) = lower(btrim(p_share_code))
    and allow_self_signup = true
    and status in (
      'draft',
      'pending_confirmation',
      'ready_for_assignment',
      'assigned',
      'in_progress',
      'round_finished'
    )
  limit 1;

  if not found then
    raise exception 'session_not_found_or_closed' using errcode = 'P0001';
  end if;

  select * into v_player
  from public.players
  where auth_user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'player_not_found' using errcode = 'P0001';
  end if;

  v_trim_name := nullif(btrim(p_session_display_name), '');
  if v_trim_name is null then
    raise exception 'invalid_display_name' using errcode = 'P0001';
  end if;
  if length(v_trim_name) < 1 or length(v_trim_name) > 100 then
    raise exception 'invalid_display_name' using errcode = 'P0001';
  end if;

  if p_self_level is null or not public.is_valid_level(p_self_level) then
    p_self_level := 6;
  end if;

  -- Determine main vs waitlist
  select count(*)::integer into v_active_count
  from public.session_participants
  where session_id = v_session.id
    and is_removed = false
    and status in ('confirmed_main', 'promoted_from_waitlist');

  v_cap := v_session.max_participants;
  if v_cap is not null and v_cap > 0 and v_active_count >= v_cap then
    v_new_status := 'waitlist';
    select coalesce(max(waitlist_order), 0) + 1 into v_waitlist_order
    from public.session_participants
    where session_id = v_session.id
      and is_removed = false
      and status = 'waitlist';
  else
    v_new_status := 'confirmed_main';
    v_waitlist_order := null;
  end if;

  -- Lock existing record if any (unique(session_id, player_id))
  select * into v_sp
  from public.session_participants
  where session_id = v_session.id
    and player_id = v_player.id
  for update;

  if found then
    -- If already active, prevent double signup
    if v_sp.is_removed = false and v_sp.status in ('confirmed_main','promoted_from_waitlist','waitlist','pending','completed') then
      raise exception 'already_signed_up' using errcode = 'P0001';
    end if;

    -- Allow re-signup only for cancelled / unavailable / no_show (and removed ones)
    if v_sp.status not in ('cancelled','unavailable','no_show') and v_sp.is_removed = false then
      raise exception 'not_allowed_to_resignup' using errcode = 'P0001';
    end if;

    update public.session_participants
    set
      source_type = 'self_signup',
      status = v_new_status,
      waitlist_order = v_waitlist_order,
      self_level = p_self_level,
      session_effective_level = p_self_level,
      signup_note = nullif(btrim(p_signup_note), ''),
      session_display_name = v_trim_name,
      is_removed = false,
      updated_at = now()
    where id = v_sp.id;

    return json_build_object(
      'ok', true,
      'id', v_sp.id,
      'status', v_new_status,
      'waitlist_order', v_waitlist_order
    );
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
    session_display_name,
    is_removed
  )
  values (
    v_session.id,
    v_player.id,
    'self_signup',
    v_new_status,
    v_waitlist_order,
    p_self_level,
    p_self_level,
    nullif(btrim(p_signup_note), ''),
    v_trim_name,
    false
  )
  returning id into v_sp.id;

  return json_build_object(
    'ok', true,
    'id', v_sp.id,
    'status', v_new_status,
    'waitlist_order', v_waitlist_order
  );
end;
$$;

grant execute on function public.self_signup_to_session_by_share_code(text, smallint, text, text) to authenticated, service_role;

