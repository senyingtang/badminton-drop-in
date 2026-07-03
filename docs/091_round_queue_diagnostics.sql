-- 091_round_queue_diagnostics.sql
-- 排組 queue 規劃用診斷（read-only）
-- 依環境調整條件後執行。若欄位與下列查詢不符，請先跑「0) Schema introspection」。

-- =============================================================================
-- 0) Schema introspection（建議先跑）
-- =============================================================================

-- 0a) public.rounds 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rounds'
order by ordinal_position;

-- 0b) public.matches 欄位（現行比賽表；舊版可能為 round_matches）
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'matches'
order by ordinal_position;

-- 0c) public.sessions 面場相關欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sessions'
  and column_name in ('id', 'title', 'status', 'court_count', 'metadata', 'venue_id')
order by ordinal_position;

-- 0d) public.session_courts（若存在）
select
  to_regclass('public.session_courts') is not null as session_courts_exists;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_courts'
order by ordinal_position;

-- 0e) public.assignment_recommendations / items
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assignment_recommendations'
order by ordinal_position;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assignment_recommendation_items'
order by ordinal_position;

-- 0f) round / recommendation status enum
select unnest(enum_range(null::public.round_status_type))::text as round_status;

select unnest(enum_range(null::public.recommendation_status_type))::text as recommendation_status;

-- =============================================================================
-- 1) sessions court_count 與 session_courts 抽樣（最近 10 場非終態）
-- =============================================================================
select
  s.id,
  s.title,
  s.status,
  s.court_count,
  (select count(*) from public.session_courts sc where sc.session_id = s.id) as session_courts_rows,
  s.metadata -> 'rented_court_nos' as rented_court_nos
from public.sessions s
where s.status not in ('session_finished', 'cancelled')
order by s.start_at desc nulls last
limit 10;

-- =============================================================================
-- 2) 最近 5 場「有 rounds 資料」的 session：round / match 摘要
-- =============================================================================
with recent as (
  select distinct r.session_id
  from public.rounds r
  order by r.session_id desc
  limit 5
)
select
  s.id as session_id,
  s.title,
  s.court_count,
  r.id as round_id,
  r.court_no,
  r.round_no,
  r.status as round_status,
  r.locked_at,
  r.finished_at,
  m.id as match_id,
  m.court_no as match_court_no,
  m.match_label,
  m.final_score_team_1,
  m.final_score_team_2,
  m.confirmed_at
from recent rec
join public.sessions s on s.id = rec.session_id
join public.rounds r on r.session_id = s.id
left join public.matches m on m.round_id = r.id
order by s.id, r.court_no, r.round_no desc, m.court_no;

-- =============================================================================
-- 3) court_no 使用狀況：每場次各面場最大 round_no、各 status 計數
-- =============================================================================
select
  r.session_id,
  r.court_no,
  max(r.round_no) as max_round_no,
  count(*) filter (where r.status = 'draft') as draft_cnt,
  count(*) filter (where r.status = 'locked') as locked_cnt,
  count(*) filter (where r.status = 'finished') as finished_cnt,
  count(*) filter (where r.status = 'cancelled') as cancelled_cnt
from public.rounds r
group by r.session_id, r.court_no
order by r.session_id desc, r.court_no
limit 50;

-- =============================================================================
-- 4) status 使用狀況（全庫 rounds 分佈）
-- =============================================================================
select
  r.status,
  count(*) as cnt
from public.rounds r
group by r.status
order by cnt desc;

-- =============================================================================
-- 5) matches.court_no 與 rounds.court_no 不一致（應為 0 筆）
-- =============================================================================
select
  m.id as match_id,
  m.round_id,
  m.court_no as match_court_no,
  r.court_no as round_court_no,
  r.session_id
from public.matches m
join public.rounds r on r.id = m.round_id
where m.court_no is distinct from r.court_no
limit 20;

-- =============================================================================
-- 6) 指定 session 詳查（將 :session_id 換成 uuid）
-- =============================================================================
-- select
--   r.id,
--   r.court_no,
--   r.round_no,
--   r.status,
--   r.locked_at,
--   r.finished_at,
--   m.id as match_id,
--   m.match_label,
--   (select count(*) from public.match_team_players mtp
--    join public.match_teams mt on mt.id = mtp.match_team_id
--    where mt.match_id = m.id) as player_cnt
-- from public.rounds r
-- left join public.matches m on m.round_id = r.id
-- where r.session_id = :session_id
-- order by r.court_no, r.round_no desc;

-- =============================================================================
-- 7) 是否存在 legacy round_matches 表
-- =============================================================================
select to_regclass('public.round_matches') is not null as round_matches_table_exists;
