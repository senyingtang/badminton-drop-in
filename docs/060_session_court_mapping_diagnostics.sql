-- 060_session_court_mapping_diagnostics.sql
-- session_courts / rounds 對應與 mapping 衝突診斷（僅查詢，可重複執行）

-- A. 全部 session_courts
select *
from public.session_courts
order by session_id, sort_order, court_no;

-- B. rounds 與場次是否已完成 058 物理場號回填標記（標記在 sessions.metadata）
select
  r.id,
  r.session_id,
  r.round_no,
  r.court_no,
  r.status,
  s.metadata->>'058_court_physical_done' as session_058_physical_done
from public.rounds r
join public.sessions s on s.id = r.session_id
order by r.session_id, r.round_no, r.court_no, r.created_at;

-- C. 潛在 mapping 衝突：若套用 slot→physical 會與「另一筆」round 撞 (session_id, round_no, 目標 physical court_no)
with candidates as (
  select
    r.id as round_id,
    r.session_id,
    r.round_no,
    r.court_no as slot_court_no,
    sc.court_no as target_physical_court_no
  from public.rounds r
  inner join public.session_courts sc
    on sc.session_id = r.session_id
   and sc.sort_order = r.court_no
  inner join public.sessions s
    on s.id = r.session_id
   and coalesce(s.metadata->>'058_court_physical_done', '') <> 'true'
)
select
  c.round_id,
  c.session_id,
  c.round_no,
  c.slot_court_no,
  c.target_physical_court_no
from candidates c
inner join public.rounds r0 on r0.id = c.round_id
where exists (
  select 1
  from public.rounds r2
  where r2.session_id = r0.session_id
    and r2.round_no = r0.round_no
    and r2.court_no = c.target_physical_court_no
    and r2.id <> c.round_id
);

-- D. 已存在之 duplicate（理論上 unique 存在時不應有列）
select session_id, court_no, round_no, count(*) as cnt
from public.rounds
group by session_id, court_no, round_no
having count(*) > 1;
