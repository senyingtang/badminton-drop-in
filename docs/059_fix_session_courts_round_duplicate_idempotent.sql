-- 059_fix_session_courts_round_duplicate_idempotent.sql
-- 修正 058 重跑／既有 locked round 仍 insert rounds 造成的 23505；
-- 並讓 apply_assignment 在 (session_id, court_no, round_no) 已存在時重用 draft 或拒絕非 draft。
--
-- 建議在曾執行過 058 但失敗或需重跑時：先執行本檔，再視需要重跑已修正的 058（或僅依賴本檔 + 058 之 ensure/backfill）。
--
-- 新環境：可 058 → 057；若 058 曾舊版失敗，改為 059 →（修正後）058 → 057。

begin;

-- rounds.updated_at（001 通常已有）
alter table public.rounds
  add column if not exists updated_at timestamptz not null default now();

-- 唯一鍵供 ON CONFLICT（若環境僅有 constraint 名稱不同，仍為同一組欄位）
-- 029 已建立 rounds_session_court_round_uniq；若不存在則補上
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'rounds'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%session_id%'
      and pg_get_constraintdef(c.oid) like '%court_no%'
      and pg_get_constraintdef(c.oid) like '%round_no%'
  ) then
    alter table public.rounds
      add constraint rounds_session_court_round_uniq unique (session_id, court_no, round_no);
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- ensure_session_courts_from_metadata：單筆 insert 可重複執行
-- ---------------------------------------------------------------------------
create or replace function public.ensure_session_courts_from_metadata(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_nos int[];
  v_labels text[];
  v_cnt int;
  i int;
  v_no int;
  v_lab text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_can_access_session(p_session_id) then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.session_courts where session_id = p_session_id) then
    return;
  end if;

  v_cnt := greatest(1, coalesce(v_session.court_count, 1));

  begin
    select array_agg(x::int order by x)
      into v_nos
    from jsonb_array_elements_text(coalesce(v_session.metadata->'rented_court_nos', '[]'::jsonb)) as t(x)
    where (x::text)::int > 0;
  exception when others then
    v_nos := null;
  end;

  if v_nos is not null and array_length(v_nos, 1) >= v_cnt then
    v_nos := v_nos[1:v_cnt];
  elsif v_nos is not null and array_length(v_nos, 1) > 0 then
    null;
  else
    v_nos := array(select generate_series(1, v_cnt));
  end if;

  begin
    select array_agg(trim(both '"' from elem::text) order by ord)
      into v_labels
    from jsonb_array_elements_text(coalesce(v_session.metadata->'rented_court_labels', '[]'::jsonb))
      with ordinality as t(elem, ord);
  exception when others then
    v_labels := null;
  end;

  for i in 1..coalesce(array_length(v_nos, 1), v_cnt)
  loop
    v_no := v_nos[i];
    v_lab := case
      when v_labels is not null and i <= coalesce(array_length(v_labels, 1), 0)
        then nullif(trim(v_labels[i]), '')
      else null
    end;
    insert into public.session_courts (session_id, court_no, label, sort_order)
    values (p_session_id, v_no, v_lab, i)
    on conflict (session_id, sort_order) do nothing;
  end loop;
end;
$$;

grant execute on function public.ensure_session_courts_from_metadata(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- apply_assignment（四參數）：已存在同鍵 round 時 — draft 則清空並重用；其餘狀態 raise
-- ---------------------------------------------------------------------------
create or replace function public.apply_assignment_recommendation_and_create_round(
  input_session_id uuid,
  input_court_no integer,
  input_round_no integer,
  input_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_rec_id uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_t1_id uuid;
  v_t2_id uuid;
  v_slot int;
  v_team jsonb;
  v_participant_id uuid;
  v_physical int;
  v_existing public.rounds%rowtype;
  v_old_rec uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if input_court_no is null or input_court_no < 1 then
    raise exception 'invalid_court_no';
  end if;

  v_slot := input_court_no;
  v_round_id := null;

  select * into v_session from public.sessions where id = input_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if not public.user_is_session_host(input_session_id)
     and not public.user_manages_venue(v_session.venue_id)
     and not public.is_platform_admin()
  then
    raise exception 'forbidden';
  end if;

  perform public.ensure_session_courts_from_metadata(input_session_id);

  v_physical := public.session_physical_court_no(input_session_id, v_slot);

  select * into v_existing
  from public.rounds r
  where r.session_id = input_session_id
    and r.court_no = v_physical
    and r.round_no = input_round_no;

  if found then
    if v_existing.status in ('locked', 'in_progress') then
      raise exception 'ROUND_ALREADY_LOCKED'
        using errcode = 'P0001',
          hint = '該場地與輪次已有鎖定或進行中之輪次，請先結束或解鎖後再套用排組。';
    elsif v_existing.status = 'finished' then
      raise exception 'ROUND_ALREADY_FINISHED'
        using errcode = 'P0001',
          hint = '該輪次已完成，無法再套用草稿排組。';
    elsif v_existing.status = 'cancelled' then
      raise exception 'ROUND_NOT_EDITABLE'
        using errcode = 'P0001',
          hint = '該輪次已取消。';
    elsif v_existing.status <> 'draft' then
      raise exception 'ROUND_NOT_EDITABLE'
        using errcode = 'P0001',
          hint = format('round status=%s', v_existing.status);
    end if;

    v_round_id := v_existing.id;
    v_old_rec := v_existing.recommendation_id;

    delete from public.matches where round_id = v_round_id;

    if v_old_rec is not null then
      delete from public.assignment_recommendation_items
      where recommendation_id = v_old_rec;
      delete from public.assignment_recommendations
      where id = v_old_rec;
    end if;
  end if;

  insert into public.assignment_recommendations (
    session_id, round_no, court_no, status, source, rule_summary, debug_payload
  ) values (
    input_session_id,
    input_round_no,
    v_slot,
    'applied',
    'rule_engine',
    coalesce(input_payload->>'rule_summary', ''),
    coalesce(input_payload->'debugInfo', '{}'::jsonb)
  )
  returning id into v_rec_id;

  for v_team in select jsonb_array_elements(coalesce(input_payload->'assignments', '[]'::jsonb))
  loop
    if coalesce((v_team->>'courtNo')::int, 0) <> v_slot then
      continue;
    end if;

    for v_participant_id in
      select (x->>'participantId')::uuid
      from jsonb_array_elements(coalesce(v_team->'team1','[]'::jsonb)) as x
    loop
      insert into public.assignment_recommendation_items (
        recommendation_id, court_no, team_no, participant_id
      ) values (v_rec_id, v_slot, 1, v_participant_id);
    end loop;

    for v_participant_id in
      select (x->>'participantId')::uuid
      from jsonb_array_elements(coalesce(v_team->'team2','[]'::jsonb)) as x
    loop
      insert into public.assignment_recommendation_items (
        recommendation_id, court_no, team_no, participant_id
      ) values (v_rec_id, v_slot, 2, v_participant_id);
    end loop;
  end loop;

  if v_round_id is null then
    insert into public.rounds (
      session_id, court_no, round_no, status, recommendation_id
    ) values (
      input_session_id, v_physical, input_round_no, 'draft', v_rec_id
    )
    returning id into v_round_id;
  else
    update public.rounds
    set recommendation_id = v_rec_id,
        updated_at = now()
    where id = v_round_id;
  end if;

  insert into public.matches (session_id, round_id, court_no, match_label)
  values (
    input_session_id,
    v_round_id,
    v_physical,
    format('R%s-%s號', input_round_no, v_physical)
  )
  returning id into v_match_id;

  insert into public.match_teams (match_id, team_no) values (v_match_id, 1) returning id into v_t1_id;
  insert into public.match_teams (match_id, team_no) values (v_match_id, 2) returning id into v_t2_id;

  insert into public.match_team_players (match_team_id, participant_id)
  select v_t1_id, participant_id
  from public.assignment_recommendation_items
  where recommendation_id = v_rec_id and court_no = v_slot and team_no = 1;

  insert into public.match_team_players (match_team_id, participant_id)
  select v_t2_id, participant_id
  from public.assignment_recommendation_items
  where recommendation_id = v_rec_id and court_no = v_slot and team_no = 2;

  return v_round_id;
end;
$$;

grant execute on function public.apply_assignment_recommendation_and_create_round(uuid, integer, integer, jsonb) to authenticated, service_role;

commit;
