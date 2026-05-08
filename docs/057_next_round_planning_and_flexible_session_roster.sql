-- 057_next_round_planning_and_flexible_session_roster.sql
-- 團主自動入場、名單彈性欄位、本輪後離場、公開報名時段、session 準備 RPC、kb_session_events
--
-- 建議先執行 docs/058_session_courts_actual_court_numbers.sql：
-- session_prepare_for_host 會呼叫 ensure_session_courts_from_metadata（定義於 058）。

begin;

alter table public.sessions
  add column if not exists max_participants integer;

comment on column public.sessions.max_participants is '正選上限；超額自動候補（舊專案若無此欄，signup RPC 會用到）';

-- 1) source_type: host_auto
do $$
begin
  alter type public.session_participant_source_type add value if not exists 'host_auto';
exception
  when duplicate_object then null;
end $$;

-- 2) session_participants 擴充
alter table public.session_participants
  add column if not exists role_in_session text,
  add column if not exists leave_after_current_round boolean not null default false;

comment on column public.session_participants.role_in_session is '例如 host_player；團主自動入場時標記';
comment on column public.session_participants.leave_after_current_round is '本輪已鎖定出賽中仍打完本輪；結束本輪後自動取消並移出名單';

-- 3) kb_session_events
create table if not exists public.kb_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  target_participant_id uuid references public.session_participants(id) on delete set null,
  event_type text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_kb_session_events_session on public.kb_session_events(session_id);
create index if not exists idx_kb_session_events_created on public.kb_session_events(created_at desc);

alter table public.kb_session_events enable row level security;

drop policy if exists kb_session_events_host_read on public.kb_session_events;
create policy kb_session_events_host_read
on public.kb_session_events
for select
using (public.user_can_access_session(session_id));

drop policy if exists kb_session_events_no_write on public.kb_session_events;
create policy kb_session_events_no_write
on public.kb_session_events
for all
using (false)
with check (false);

grant select on public.kb_session_events to authenticated;
grant all on public.kb_session_events to service_role;

create or replace function public.kb_log_session_event(
  p_session_id uuid,
  p_target_participant_id uuid,
  p_event_type text,
  p_before jsonb,
  p_after jsonb,
  p_note text default null,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.kb_session_events (
    session_id, actor_user_id, target_participant_id, event_type, before_data, after_data, note
  ) values (
    p_session_id,
    coalesce(p_actor, auth.uid()),
    p_target_participant_id,
    p_event_type,
    coalesce(p_before, '{}'::jsonb),
    coalesce(p_after, '{}'::jsonb),
    p_note
  );
end;
$$;

grant execute on function public.kb_log_session_event(uuid, uuid, text, jsonb, jsonb, text, uuid) to authenticated, service_role;

-- 4) 團主自動加入正選（不重複報名）
create or replace function public.ensure_session_host_participant(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_host uuid;
  v_player_id uuid;
  v_name text;
  v_level smallint;
  v_code citext;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_is_session_host(p_session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  v_host := v_session.host_user_id;

  select id into v_player_id
  from public.players
  where auth_user_id = v_host
  limit 1;

  if v_player_id is null then
    select coalesce(nullif(trim(display_name), ''), '團主') into v_name
    from public.app_user_profiles
    where id = v_host;

    v_code := ('u' || replace(v_host::text, '-', ''))::citext;
    begin
      insert into public.players (auth_user_id, player_code, display_name, handedness, gender)
      values (v_host, v_code, coalesce(v_name, '團主'), 'unknown', 'prefer_not_to_say')
      returning id into v_player_id;
    exception when unique_violation then
      insert into public.players (auth_user_id, player_code, display_name, handedness, gender)
      values (v_host, ('u' || replace(gen_random_uuid()::text, '-', ''))::citext, coalesce(v_name, '團主'), 'unknown', 'prefer_not_to_say')
      returning id into v_player_id;
    end;
  end if;

  v_level := 6;
  begin
    select coalesce(hpp.host_confirmed_level, hpp.self_level, 6::smallint)
      into v_level
    from public.host_player_profiles hpp
    where hpp.host_user_id = v_host and hpp.player_id = v_player_id
    limit 1;
  exception when others then
    v_level := 6;
  end;

  if v_level is null or not public.is_valid_level(v_level) then
    v_level := 6;
  end if;

  insert into public.session_participants (
    session_id,
    player_id,
    source_type,
    status,
    role_in_session,
    self_level,
    session_effective_level,
    is_removed
  ) values (
    p_session_id,
    v_player_id,
    'host_auto',
    'confirmed_main',
    'host_player',
    v_level,
    v_level,
    false
  )
  on conflict (session_id, player_id) do update
    set
      role_in_session = coalesce(public.session_participants.role_in_session, excluded.role_in_session),
      source_type = case
        when public.session_participants.source_type = 'host_auto'::public.session_participant_source_type
          then 'host_auto'::public.session_participant_source_type
        else public.session_participants.source_type
      end,
      updated_at = now();

  perform public.kb_log_session_event(
    p_session_id,
    null,
    'ensure_host_participant',
    '{}'::jsonb,
    jsonb_build_object('player_id', v_player_id),
    null,
    auth.uid()
  );
end;
$$;

grant execute on function public.ensure_session_host_participant(uuid) to authenticated, service_role;

create or replace function public.session_prepare_for_host(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_session_courts_from_metadata(p_session_id);
  perform public.ensure_session_host_participant(p_session_id);
end;
$$;

grant execute on function public.session_prepare_for_host(uuid) to authenticated, service_role;

-- 5) 本輪後離場（標記）
create or replace function public.host_set_participant_leave_after_round(
  p_session_participant_id uuid,
  p_leave boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.session_participants%rowtype;
  v_session public.sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select * into v_sp from public.session_participants where id = p_session_participant_id for update;
  if not found then
    raise exception 'session participant not found';
  end if;

  select * into v_session from public.sessions where id = v_sp.session_id;

  if not public.user_is_session_host(v_sp.session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  update public.session_participants
  set leave_after_current_round = p_leave,
      updated_at = now()
  where id = p_session_participant_id;

  perform public.kb_log_session_event(
    v_sp.session_id,
    p_session_participant_id,
    'leave_after_round_toggle',
    jsonb_build_object('leave_after_current_round', v_sp.leave_after_current_round),
    jsonb_build_object('leave_after_current_round', p_leave),
    null,
    auth.uid()
  );
end;
$$;

grant execute on function public.host_set_participant_leave_after_round(uuid, boolean) to authenticated, service_role;

-- 6) list_session_participants_for_host：回傳 role / leave 旗標
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
  host_confirmed_level smallint,
  session_effective_level smallint,
  signup_note text,
  is_removed boolean,
  created_at timestamptz,
  player_code citext,
  display_name text,
  total_matches_played integer,
  consecutive_rounds_played integer,
  is_locked_for_current_round boolean,
  role_in_session text,
  leave_after_current_round boolean
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
    sp.host_confirmed_level,
    sp.session_effective_level,
    sp.signup_note,
    sp.is_removed,
    sp.created_at,
    p.player_code,
    p.display_name,
    sp.total_matches_played,
    sp.consecutive_rounds_played,
    sp.is_locked_for_current_round,
    sp.role_in_session,
    sp.leave_after_current_round
  from public.session_participants sp
  join public.players p on p.id = sp.player_id
  where sp.session_id = input_session_id
    and sp.is_removed = false
  order by sp.priority_order nulls last, sp.created_at asc;
end;
$$;

grant execute on function public.list_session_participants_for_host(uuid) to authenticated, service_role;

-- 7) 結束本輪後處理「本輪後離場」
create or replace function public.finish_round_and_release_locks(
  input_round_id uuid,
  input_finished_by_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
begin
  select * into v_round
  from public.rounds
  where id = input_round_id
  for update;

  if not found then
    raise exception 'round not found';
  end if;

  update public.rounds
  set status = 'finished',
      finished_at = now(),
      finished_by_user_id = coalesce(input_finished_by_user_id, auth.uid()),
      updated_at = now()
  where id = input_round_id;

  update public.session_participants sp
  set
    is_locked_for_current_round = false,
    updated_at = now()
  where exists (
    select 1
    from public.match_team_players mtp
    join public.match_teams mt on mt.id = mtp.match_team_id
    join public.matches m on m.id = mt.match_id
    where m.round_id = input_round_id
      and mtp.participant_id = sp.id
  );

  update public.session_participants sp
  set
    consecutive_rounds_played = 0,
    updated_at = now()
  where sp.session_id = v_round.session_id
    and not exists (
      select 1
      from public.match_team_players mtp
      join public.match_teams mt on mt.id = mtp.match_team_id
      join public.matches m on m.id = mt.match_id
      where m.round_id = input_round_id
        and mtp.participant_id = sp.id
    );

  update public.session_participants sp
  set
    status = 'cancelled',
    is_removed = true,
    leave_after_current_round = false,
    updated_at = now()
  where sp.session_id = v_round.session_id
    and sp.leave_after_current_round = true
    and sp.is_removed = false;

  if exists (
    select 1
    from public.rounds r
    where r.session_id = v_round.session_id
      and r.status = 'locked'
  ) then
    update public.sessions
    set status = 'in_progress',
        updated_at = now()
    where id = v_round.session_id;
  elsif exists (
    select 1
    from public.rounds r
    where r.session_id = v_round.session_id
      and r.status = 'draft'
  ) then
    update public.sessions
    set status = 'in_progress',
        updated_at = now()
    where id = v_round.session_id;
  else
    update public.sessions
    set status = 'round_finished',
        updated_at = now()
    where id = v_round.session_id;
  end if;
end;
$$;

grant execute on function public.finish_round_and_release_locks(uuid, uuid) to authenticated, service_role;

-- 8) 開放報名／排組期間仍可分享碼報名（含候補）
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
      'registration_open',
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

commit;
