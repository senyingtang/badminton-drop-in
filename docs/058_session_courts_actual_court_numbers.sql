-- 058_session_courts_actual_court_numbers.sql
-- 以 session_courts 儲存實際租借場地編號；rounds / matches 使用實體 court_no（例如 2、3），
-- 排組 API 仍以 sort_order（1..N 面場序）對應到實體場號。
--
-- 若曾執行舊版 058 發生 23505 或需修正 apply_assignment：請先執行
-- docs/059_fix_session_courts_round_duplicate_idempotent.sql，再重跑本檔（可重複執行）。
-- 若 rounds UPDATE 報 42P01（FROM-JOIN 引用目標別名）：請執行 docs/060_fix_058_update_alias_scope.sql，或拉取本檔後重跑。
-- rounds 的 court_no 回填僅在 sessions.metadata->058_court_physical_done 尚未為 true 時執行，避免重跑誤對應。

begin;

-- 1) session_courts
create table if not exists public.session_courts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  court_no integer not null,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_session_courts_court_no check (court_no >= 1)
);

create unique index if not exists uq_session_courts_session_sort
  on public.session_courts(session_id, sort_order);

create index if not exists idx_session_courts_session on public.session_courts(session_id);

comment on table public.session_courts is '場次實際租借面場：sort_order 為排組時的 1..N 序，court_no 為球館實際場地編號';

alter table public.session_courts enable row level security;

drop policy if exists session_courts_select_access on public.session_courts;
create policy session_courts_select_access
on public.session_courts
for select
using (public.user_can_access_session(session_id));

drop policy if exists session_courts_no_direct_write on public.session_courts;
create policy session_courts_no_direct_write
on public.session_courts
for all
using (false)
with check (false);

grant select on public.session_courts to authenticated;
grant all on public.session_courts to service_role;

-- 2) 由 sessions.metadata 與 court_count 補齊 session_courts（僅在尚無列時）
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

-- 3) 依 sort_order 解析實體場號（無表時 fallback = slot）
create or replace function public.session_physical_court_no(p_session_id uuid, p_slot int)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select sc.court_no from public.session_courts sc
     where sc.session_id = p_session_id and sc.sort_order = p_slot
     limit 1),
    p_slot
  );
$$;

grant execute on function public.session_physical_court_no(uuid, int) to authenticated, service_role;

-- 4) 為尚無 session_courts 的場次補列：第 i 面優先使用 rented_court_nos[i]，否則 fallback i
insert into public.session_courts (session_id, court_no, label, sort_order)
select s.id,
       coalesce(
         case
           when jsonb_typeof(s.metadata->'rented_court_nos') = 'array'
                and (s.metadata->'rented_court_nos'->>(g.i - 1)) is not null
             then nullif((s.metadata->'rented_court_nos'->>(g.i - 1))::text, '')::int
           else null
         end,
         g.i
       ) as court_no,
       case
         when jsonb_typeof(s.metadata->'rented_court_labels') = 'array'
              and jsonb_array_length(coalesce(s.metadata->'rented_court_labels', '[]'::jsonb)) >= g.i
           then nullif(trim(both '"' from (s.metadata->'rented_court_labels'->>(g.i - 1))::text), '')
         else null
       end as label,
       g.i as sort_order
from public.sessions s
cross join lateral generate_series(1, greatest(1, coalesce(s.court_count, 1))) as g(i)
where not exists (select 1 from public.session_courts sc where sc.session_id = s.id)
on conflict (session_id, sort_order) do nothing;

-- 僅首次（或未標記完成）將 rounds.court_no 由面場序對應為實體場號；重跑不會再誤更新。
-- 使用 CTE：PostgreSQL 不允許在 UPDATE 的 FROM-JOIN ON 中引用目標表別名（如 rr）。
-- safe：排除「目標 (session_id, physical_court_no, round_no) 已被其他 round 列占用」之列，避免 23505。
with candidates as (
  select
    r.id as round_id,
    sc.court_no as physical_court_no
  from public.rounds r
  inner join public.session_courts sc
    on sc.session_id = r.session_id
   and sc.sort_order = r.court_no
  inner join public.sessions s
    on s.id = r.session_id
   and coalesce(s.metadata->>'058_court_physical_done', '') <> 'true'
  where exists (select 1 from public.session_courts s2 where s2.session_id = r.session_id)
),
safe as (
  select c.round_id, c.physical_court_no
  from candidates c
  inner join public.rounds r0 on r0.id = c.round_id
  where not exists (
    select 1
    from public.rounds r2
    where r2.session_id = r0.session_id
      and r2.round_no = r0.round_no
      and r2.court_no = c.physical_court_no
      and r2.id <> c.round_id
  )
)
update public.rounds r
set court_no = s.physical_court_no,
    updated_at = now()
from safe s
where r.id = s.round_id
  and r.court_no is distinct from s.physical_court_no;

update public.matches mm
set court_no = rr.court_no
from public.rounds rr
where mm.round_id = rr.id
  and mm.court_no is distinct from rr.court_no;

update public.sessions s
set metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('058_court_physical_done', true)
where exists (select 1 from public.session_courts sc where sc.session_id = s.id);

-- 5) 覆寫 apply_assignment：實體 court_no；同鍵已有 draft 則重用，locked/finished 則拒絕（與 059 一致）
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
