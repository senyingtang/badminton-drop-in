-- 1) 分享報名：可選自訂球員代碼（英數，normalize 後 3–30 字，全平台唯一）
-- 2) 任一場次加入 session_participants 時，自動為該場 host 建立／啟用 host_player_profiles（球員名單頁資料來源）
-- 須在 015 之後執行（沿用 duplicate_name 邏輯）。

-- ── 觸發器：報名／手動加入皆會同步團主球員名單 ─────────────────────────────
create or replace function public.ensure_host_player_profile_for_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_level smallint;
  v_confirmed smallint;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if new.is_removed then
    return new;
  end if;

  select host_user_id into v_host
  from public.sessions
  where id = new.session_id;

  if v_host is null then
    return new;
  end if;

  v_level := new.self_level;
  if v_level is not null and not public.is_valid_level(v_level) then
    v_level := null;
  end if;
  v_confirmed := v_level;

  insert into public.host_player_profiles (
    host_user_id,
    player_id,
    self_level,
    host_confirmed_level,
    default_level_adjustment,
    warning_status,
    is_blacklisted,
    private_note,
    is_active
  ) values (
    v_host,
    new.player_id,
    v_level,
    v_confirmed,
    0,
    'normal',
    false,
    null,
    true
  )
  on conflict (host_user_id, player_id) do update set
    is_active = true,
    self_level = coalesce(excluded.self_level, host_player_profiles.self_level),
    host_confirmed_level = coalesce(excluded.host_confirmed_level, host_player_profiles.host_confirmed_level),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_session_participants_ensure_host_profile on public.session_participants;
create trigger trg_session_participants_ensure_host_profile
  after insert on public.session_participants
  for each row
  execute function public.ensure_host_player_profile_for_participant();

-- ── 補齊既有報名資料（僅缺 host_player_profiles 的組合）────────────────────
insert into public.host_player_profiles (
  host_user_id,
  player_id,
  self_level,
  host_confirmed_level,
  default_level_adjustment,
  warning_status,
  is_blacklisted,
  is_active
)
select
  s.host_user_id,
  sp.player_id,
  case when sp.self_level is not null and public.is_valid_level(sp.self_level) then sp.self_level else null end,
  case when sp.self_level is not null and public.is_valid_level(sp.self_level) then sp.self_level else null end,
  0,
  'normal',
  false,
  true
from public.session_participants sp
join public.sessions s on s.id = sp.session_id
where sp.is_removed = false
on conflict (host_user_id, player_id) do update set
  is_active = true,
  updated_at = now();

-- ── 取代 signup_via_share_code：新增 p_desired_player_code ────────────────
drop function if exists public.signup_via_share_code(text, text, smallint, text);

create or replace function public.signup_via_share_code(
  p_share_code text,
  p_display_name text,
  p_self_level smallint default 6,
  p_signup_note text default null,
  p_desired_player_code text default null
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
  v_desired citext;
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

  if p_desired_player_code is not null and length(trim(p_desired_player_code)) > 0 then
    v_desired := public.normalize_player_code(trim(p_desired_player_code));
    if v_desired is null or length(trim(v_desired::text)) < 3 or length(trim(v_desired::text)) > 30 then
      raise exception 'invalid_player_code' using errcode = 'P0001';
    end if;
    if not public.is_valid_player_code(v_desired::text) then
      raise exception 'invalid_player_code' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.players where player_code = v_desired) then
      raise exception 'duplicate_player_code' using errcode = 'P0001';
    end if;
    v_code := v_desired;
  else
    v_code := ('g' || replace(gen_random_uuid()::text, '-', ''))::citext;
  end if;

  insert into public.players (
    auth_user_id,
    player_code,
    display_name,
    handedness,
    gender
  ) values (
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
  ) values (
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
    'display_name', p_display_name,
    'player_code', v_code::text
  );
end;
$$;

grant execute on function public.signup_via_share_code(text, text, smallint, text, text) to anon, authenticated, service_role;
