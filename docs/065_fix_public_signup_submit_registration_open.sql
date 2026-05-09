-- 065_fix_public_signup_submit_registration_open.sql
-- 最小修復：只修「送出報名」用的 RPC：public.self_signup_to_session_by_share_code
-- 目標：
-- - 使用 sessions.share_signup_code 查 session（唯一公開碼欄位）
-- - 允許 status = registration_open 報名
-- - 拆分錯誤訊息：link invalid vs status not open（不再混在同一句）
-- 限制：不處理 rounds/matches/terminal sessions/session_courts；不新增 share_code/public_code/signup_code/slug。

begin;

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

  -- 1) 先確認分享碼是否存在（不混用 status 條件）
  select * into v_session
  from public.sessions
  where lower(btrim(share_signup_code)) = lower(btrim(p_share_code))
    and allow_self_signup = true
  limit 1;

  if not found then
    raise exception 'signup_link_invalid' using errcode = 'P0001';
  end if;

  -- 2) 再檢查是否允許報名（狀態白名單需包含 registration_open）
  if v_session.status not in (
    'draft',
    'pending_confirmation',
    'registration_open',
    'ready_for_assignment',
    'assigned',
    'in_progress',
    'round_finished'
  ) then
    raise exception 'session_signup_not_open' using errcode = 'P0001';
  end if;

  -- 3) 確認玩家存在
  select * into v_player
  from public.players
  where auth_user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'player_not_found' using errcode = 'P0001';
  end if;

  -- 4) 一次性匿名暱稱
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
      signup_note = p_signup_note,
      self_level = p_self_level,
      session_display_name = v_trim_name,
      is_removed = false,
      updated_at = now()
    where id = v_sp.id;

    return (select to_json(sp.*) from public.session_participants sp where sp.id = v_sp.id);
  end if;

  insert into public.session_participants (
    session_id,
    player_id,
    source_type,
    status,
    waitlist_order,
    signup_note,
    self_level,
    session_display_name
  ) values (
    v_session.id,
    v_player.id,
    'self_signup',
    v_new_status,
    v_waitlist_order,
    p_signup_note,
    p_self_level,
    v_trim_name
  )
  returning * into v_sp;

  return to_json(v_sp.*);
end;
$$;

grant execute on function public.self_signup_to_session_by_share_code(text, smallint, text, text) to authenticated, anon, service_role;

commit;

