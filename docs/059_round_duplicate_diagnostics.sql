-- 059_round_duplicate_diagnostics.sql
-- 診斷 rounds / session_courts 與 (session_id, court_no, round_no) 唯一性（僅查詢，可重複執行）

-- A. 理論上若有重複鍵（在未加 unique 前或資料異常匯入時）會出現；正常有 rounds_session_court_round_uniq 時不應有列
select session_id, court_no, round_no, count(*) as cnt
from public.rounds
group by session_id, court_no, round_no
having count(*) > 1;

-- B. 單一場次 rounds（請替換 :session_id）
-- select id, session_id, court_no, round_no, status, created_at
-- from public.rounds
-- where session_id = 'REPLACE_SESSION_ID'::uuid
-- order by round_no, court_no, created_at;

-- C. 同場次 session_courts
-- select *
-- from public.session_courts
-- where session_id = 'REPLACE_SESSION_ID'::uuid
-- order by sort_order, court_no;

-- D. 需強制重跑 058 的 rounds 回填時，可先清掉該場次之標記再執行修正後的 058：
-- update public.sessions
-- set metadata = metadata - '058_court_physical_done'
-- where id = 'REPLACE_SESSION_ID'::uuid;
