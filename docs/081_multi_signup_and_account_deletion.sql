-- 081: 多人代報名（session_participants 欄位 + RPC）與會員軟刪除／匿名化（app_user_profiles）
-- 安全可重跑（IF NOT EXISTS / CREATE OR REPLACE）。
--
-- 重點：
-- 1) 代報名每位來賓仍建立獨立 players（auth_user_id null）以滿足 player_id NOT NULL 與 unique(session_id, player_id)。
-- 2) 通知對象：notification_user_id / registered_by_user_id（見應用程式 /api/line/*）。
-- 3) 解除 app_user_profiles.id -> auth.users 的 ON DELETE CASCADE，避免刪除 Auth 時連帶刪除 profile（歷史 FK 仍指向 profile.id）。

begin;

-- ---------------------------------------------------------------------------
-- A) app_user_profiles：軟刪除與匿名化欄位
-- ---------------------------------------------------------------------------
alter table public.app_user_profiles
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists account_deleted_at timestamptz,
  add column if not exists deleted_display_name_snapshot text,
  add column if not exists anonymized_at timestamptz,
  add column if not exists avatar_url text;

comment on column public.app_user_profiles.is_deleted is '會員軟刪除：true 時後台顯示「此會員已刪除帳號」';
comment on column public.app_user_profiles.deleted_at is '首次標記刪除的時間';
comment on column public.app_user_profiles.account_deleted_at is '帳號刪除流程完成時間（匿名化／停用登入後）';
comment on column public.app_user_profiles.deleted_display_name_snapshot is '刪除前顯示名稱快照（稽核）';

create index if not exists idx_app_user_profiles_is_deleted on public.app_user_profiles (is_deleted)
  where is_deleted = true;

-- 解除與 auth.users 的 cascade（constraint 名稱以 PG 預設為準，若環境不同請手動調整）
alter table public.app_user_profiles drop constraint if exists app_user_profiles_id_fkey;

-- 不再建立指向 auth.users 的 FK：profile id 仍與註冊時的 uuid 一致，刪除／停用 Auth 由應用程式處理。

-- ---------------------------------------------------------------------------
-- B) session_participants：代報名欄位
-- ---------------------------------------------------------------------------
alter table public.session_participants
  add column if not exists registered_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  add column if not exists notification_user_id uuid references public.app_user_profiles (id) on delete set null,
  add column if not exists is_guest_registration boolean not null default false,
  add column if not exists guest_display_name text,
  add column if not exists guest_level smallint,
  add column if not exists guest_player_code text,
  add column if not exists registration_group_id uuid;

comment on column public.session_participants.registered_by_user_id is '協助報名者（代報者 A）';
comment on column public.session_participants.notification_user_id is '名單異動 LINE 通知對象（代報時為 A）';
comment on column public.session_participants.is_guest_registration is '是否為代朋友報名（來賓無 Auth）';
comment on column public.session_participants.guest_display_name is '代報名來賓暱稱';
comment on column public.session_participants.guest_level is '代報名來賓自評級數（與 self_level 同型別）';
comment on column public.session_participants.guest_player_code is '代報名識別碼（候補／取消／團主檢視）';
comment on column public.session_participants.registration_group_id is '同一次送出之多筆代報名共用';

alter table public.session_participants drop constraint if exists chk_sp_guest_registration_fields;

alter table public.session_participants
  add constraint chk_sp_guest_registration_fields
  check (
    not is_guest_registration
    or (
      guest_display_name is not null
      and length(btrim(guest_display_name)) between 1 and 100
      and guest_player_code is not null
      and length(btrim(guest_player_code)) between 1 and 64
      and guest_level is not null
      and public.is_valid_level(guest_level)
      and registered_by_user_id is not null
      and notification_user_id is not null
    )
  );

create index if not exists idx_sp_registered_by on public.session_participants (registered_by_user_id);
create index if not exists idx_sp_notification_user on public.session_participants (notification_user_id);
create index if not exists idx_sp_registration_group on public.session_participants (registration_group_id);

-- ---------------------------------------------------------------------------
-- C) 公開名單 RPC：第三參數 p_viewer_user_id（可選），回傳代報名層級與「由我代報」旗標
-- 先移除舊簽名，避免 (text, uuid) 與 (text, uuid, uuid) 預設參數解析衝突。
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_session_roster_by_share_code(text, uuid);
drop function if exists public.get_public_session_roster_by_share_code(text, uuid, uuid);

create or replace function public.get_public_session_roster_by_share_code(
  p_share_code text,
  p_viewer_player_id uuid default null,
  p_viewer_user_id uuid default null
)
returns table (
  session_participant_id uuid,
  roster_kind text,
  display_name text,
  waitlist_order integer,
  is_self boolean,
  guest_level smallint,
  is_managed_by_registrar boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with ses as (
    select s.id as session_id
    from public.sessions s
    where s.share_signup_code is not null
      and s.allow_self_signup = true
      and btrim(p_share_code) <> ''
      and lower(btrim(s.share_signup_code)) = lower(btrim(p_share_code))
      and s.status in (
        'draft',
        'registration_open',
        'pending_confirmation',
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished',
        'session_finished'
      )
    limit 1
  )
  select
    sp.id as session_participant_id,
    case
      when sp.status = 'waitlist' then 'waitlist'
      else 'main'
    end::text as roster_kind,
    coalesce(
      case when sp.is_guest_registration then nullif(btrim(sp.guest_display_name), '') end,
      nullif(btrim(sp.session_display_name), ''),
      nullif(btrim(p.display_name), ''),
      '未命名'
    )::text as display_name,
    sp.waitlist_order,
    (p_viewer_player_id is not null and sp.player_id = p_viewer_player_id) as is_self,
    case when sp.is_guest_registration then sp.guest_level else null::smallint end as guest_level,
    (
      p_viewer_user_id is not null
      and sp.is_guest_registration = true
      and sp.registered_by_user_id = p_viewer_user_id
    ) as is_managed_by_registrar
  from ses
  join public.session_participants sp on sp.session_id = ses.session_id
  join public.players p on p.id = sp.player_id
  where sp.is_removed = false
    and sp.status in (
      'confirmed_main',
      'promoted_from_waitlist',
      'waitlist',
      'completed'
    )
  order by
    case when sp.status = 'waitlist' then 1 else 0 end,
    sp.waitlist_order nulls last,
    coalesce(
      case when sp.is_guest_registration then nullif(btrim(sp.guest_display_name), '') end,
      nullif(btrim(sp.session_display_name), ''),
      p.display_name
    );
$$;

grant execute on function public.get_public_session_roster_by_share_code(text, uuid, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D) 自己報名 RPC：寫入 registered_by / notification / is_guest=false
-- ---------------------------------------------------------------------------
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
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
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
      'registration_open',
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
  where auth_user_id = v_uid
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

  select * into v_sp
  from public.session_participants
  where session_id = v_session.id
    and player_id = v_player.id
  for update;

  if found then
    if v_sp.is_removed = false and v_sp.status in ('confirmed_main','promoted_from_waitlist','waitlist','pending','completed') then
      raise exception 'already_signed_up' using errcode = 'P0001';
    end if;

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
      registered_by_user_id = v_uid,
      notification_user_id = v_uid,
      is_guest_registration = false,
      guest_display_name = null,
      guest_level = null,
      guest_player_code = null,
      registration_group_id = null,
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
    is_removed,
    registered_by_user_id,
    notification_user_id,
    is_guest_registration,
    guest_display_name,
    guest_level,
    guest_player_code,
    registration_group_id
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
    false,
    v_uid,
    v_uid,
    false,
    null,
    null,
    null,
    null
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

-- ---------------------------------------------------------------------------
-- E) 代朋友報名（多位）：每位新建 players + session_participants
-- ---------------------------------------------------------------------------
create or replace function public.self_register_guest_friends_by_share_code(
  p_share_code text,
  p_guests jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_uid uuid := auth.uid();
  v_group uuid := gen_random_uuid();
  v_elem jsonb;
  v_name text;
  v_level smallint;
  v_active_count integer;
  v_cap integer;
  v_new_status public.session_participant_status_type;
  v_waitlist_order integer;
  v_player_id uuid;
  v_sp_id uuid;
  v_code text;
  v_guest_code text;
  v_results jsonb := '[]'::jsonb;
  v_i integer;
  v_len integer;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if p_share_code is null or length(btrim(p_share_code)) < 1 then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  if p_guests is null or jsonb_typeof(p_guests) <> 'array' or jsonb_array_length(p_guests) < 1 then
    raise exception 'invalid_guests' using errcode = 'P0001';
  end if;

  v_len := jsonb_array_length(p_guests);
  if v_len > 15 then
    raise exception 'too_many_guests' using errcode = 'P0001';
  end if;

  select * into v_session
  from public.sessions
  where lower(btrim(share_signup_code)) = lower(btrim(p_share_code))
    and allow_self_signup = true
    and status in (
      'draft',
      'pending_confirmation',
      'registration_open',
      'ready_for_assignment',
      'assigned',
      'in_progress',
      'round_finished'
    )
  limit 1;

  if not found then
    raise exception 'session_not_found_or_closed' using errcode = 'P0001';
  end if;

  for v_i in 0..(v_len - 1) loop
    v_elem := p_guests -> v_i;
    v_name := nullif(btrim(coalesce(v_elem->>'display_name', v_elem->>'nickname', '')), '');
    if v_name is null or length(v_name) > 100 then
      raise exception 'invalid_guest_display_name' using errcode = 'P0001';
    end if;

    v_level := coalesce((v_elem->>'level')::smallint, (v_elem->>'self_level')::smallint, null::smallint);
    if v_level is null or not public.is_valid_level(v_level) then
      raise exception 'invalid_guest_level' using errcode = 'P0001';
    end if;

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

    v_code := ('g' || replace(gen_random_uuid()::text, '-', ''))::text;
    v_guest_code := lower(replace(gen_random_uuid()::text, '-', ''));

    insert into public.players (auth_user_id, player_code, display_name, handedness, gender)
    values (null, v_code::citext, v_name, 'unknown', 'prefer_not_to_say')
    returning id into v_player_id;

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
      is_removed,
      registered_by_user_id,
      notification_user_id,
      is_guest_registration,
      guest_display_name,
      guest_level,
      guest_player_code,
      registration_group_id
    )
    values (
      v_session.id,
      v_player_id,
      'self_signup',
      v_new_status,
      v_waitlist_order,
      v_level,
      v_level,
      null,
      v_name,
      false,
      v_uid,
      v_uid,
      true,
      v_name,
      v_level,
      v_guest_code,
      v_group
    )
    returning id into v_sp_id;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_sp_id,
        'status', v_new_status::text,
        'waitlist_order', v_waitlist_order,
        'guest_display_name', v_name,
        'guest_player_code', v_guest_code
      )
    );
  end loop;

  return json_build_object(
    'ok', true,
    'registration_group_id', v_group,
    'results', v_results
  );
end;
$$;

grant execute on function public.self_register_guest_friends_by_share_code(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F) 代報者取消單一來賓報名
-- ---------------------------------------------------------------------------
create or replace function public.self_cancel_guest_registration_by_registrar(
  p_session_participant_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sp public.session_participants%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  select * into v_sp
  from public.session_participants
  where id = p_session_participant_id
  for update;

  if not found then
    raise exception 'participant_not_found' using errcode = 'P0001';
  end if;

  if v_sp.is_guest_registration is distinct from true then
    raise exception 'not_guest_registration' using errcode = 'P0001';
  end if;

  if v_sp.registered_by_user_id is distinct from v_uid then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_sp.is_removed = true or v_sp.status in ('cancelled', 'unavailable', 'no_show') then
    return json_build_object('ok', true, 'skipped', true);
  end if;

  update public.session_participants
  set
    status = 'cancelled',
    updated_at = now()
  where id = p_session_participant_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.self_cancel_guest_registration_by_registrar(uuid) to authenticated, service_role;

commit;
