-- 067_court_slot_mapping_diagnostics.sql
-- 診斷：slot(1..N) -> 實體場號 對應是否正確
--
-- 使用方式：
-- 1) 將 params.session_id 改成要查的場次 id
-- 2) 直接在 Supabase SQL Editor 執行

with params as (
  select
    '00000000-0000-0000-0000-000000000000'::uuid as session_id
)

-- 1) sessions.metadata / court_count
select
  s.id,
  s.title,
  s.status,
  s.court_count,
  s.metadata
from public.sessions s
join params p on p.session_id = s.id;

-- 2) session_courts
select
  sc.session_id,
  sc.sort_order,
  sc.court_no,
  sc.label
from public.session_courts sc
join params p on p.session_id = sc.session_id
order by sc.sort_order asc;

-- 3) rounds
select
  r.id,
  r.round_no,
  r.court_no,
  r.status
from public.rounds r
join params p on p.session_id = r.session_id
order by r.round_no asc, r.court_no asc;

-- 4) matches
select
  m.id,
  m.round_id,
  m.court_no
from public.matches m
join public.rounds r on r.id = m.round_id
join params p on p.session_id = r.session_id
order by r.round_no asc, m.court_no asc;

-- 5) 測試 helper：slot 1/2/3 對應到實體場號
select
  p.session_id,
  public.session_physical_court_no(p.session_id, 1) as slot_1_physical,
  public.session_physical_court_no(p.session_id, 2) as slot_2_physical,
  public.session_physical_court_no(p.session_id, 3) as slot_3_physical
from params p;

-- 6) 檢查：session_courts 空但 metadata 有 rented court 的情況
select
  s.id,
  s.title,
  s.court_count,
  (s.metadata -> 'rented_court_nos') as rented_court_nos,
  (s.metadata -> 'rented_court_numbers') as rented_court_numbers,
  exists(
    select 1
    from public.session_courts sc
    where sc.session_id = s.id
  ) as has_session_courts
from public.sessions s
join params p on p.session_id = s.id
where not exists (select 1 from public.session_courts sc where sc.session_id = s.id)
  and (
    (s.metadata ? 'rented_court_nos' and jsonb_typeof(s.metadata -> 'rented_court_nos') = 'array')
    or (s.metadata ? 'rented_court_numbers' and jsonb_typeof(s.metadata -> 'rented_court_numbers') = 'array')
  );

