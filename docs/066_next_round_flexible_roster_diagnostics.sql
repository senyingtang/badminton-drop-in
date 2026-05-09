-- 066_next_round_flexible_roster_diagnostics.sql
-- 診斷：下一排組、名單彈性旗標、場地 slot 顯示（僅查詢）

-- 1) rounds status enum 值
select unnest(enum_range(null::public.round_status_type))::text as round_status;

-- 2) session_participants 欄位列表
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'session_participants'
order by ordinal_position;

-- 3) session_participants status enum 值
select unnest(enum_range(null::public.session_participant_status_type))::text as participant_status;

-- 4) 最近 10 筆 active sessions（簡單取非終態）
select id, title, status, share_signup_code, allow_self_signup, host_user_id, venue_id, created_at
from public.sessions
where status not in ('cancelled', 'session_finished')
order by created_at desc
limit 10;

-- 5) 指定 session 的 rounds / matches / participants（請替換 session_id）
-- select id, session_id, court_no, round_no, status, created_at
-- from public.rounds
-- where session_id = 'REPLACE_SESSION_ID'::uuid
-- order by round_no desc, court_no asc, created_at desc;
--
-- select id, session_id, round_id, court_no, match_label, final_score_team_1, final_score_team_2, created_at
-- from public.matches
-- where session_id = 'REPLACE_SESSION_ID'::uuid
-- order by created_at desc;
--
-- select id, session_id, player_id, source_type, status, waitlist_order, is_removed, is_locked_for_current_round,
--        unavailable_for_next_round, leave_after_current_round, roster_note, created_at
-- from public.session_participants
-- where session_id = 'REPLACE_SESSION_ID'::uuid
-- order by created_at asc;

-- 6) session_courts 欄位與資料（若表存在）
select
  to_regclass('public.session_courts') is not null as session_courts_exists,
  coalesce(to_regclass('public.session_courts')::text, 'public.session_courts (missing)') as regclass_name;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'session_courts'
order by ordinal_position;

-- select *
-- from public.session_courts
-- where session_id = 'REPLACE_SESSION_ID'::uuid
-- order by sort_order asc, court_no asc;

-- 7) 檢查是否有多個 draft round（同一 session + court_no）
select session_id, court_no, count(*) as draft_cnt
from public.rounds
where status = 'draft'
group by session_id, court_no
having count(*) > 1
order by draft_cnt desc;

-- 8) 檢查 rounds.court_no 是否能對應 session_courts（新 round 建立後應可對應）
-- select r.session_id, r.id as round_id, r.court_no, sc.sort_order, sc.court_no as physical_court_no
-- from public.rounds r
-- left join public.session_courts sc
--   on sc.session_id = r.session_id and sc.court_no = r.court_no
-- where r.session_id = 'REPLACE_SESSION_ID'::uuid
-- order by r.round_no desc, r.court_no asc;

