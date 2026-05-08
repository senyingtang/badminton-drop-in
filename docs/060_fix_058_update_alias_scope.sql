-- 060_fix_058_update_alias_scope.sql
-- 修正 058 中 UPDATE public.rounds 在 FROM-JOIN ON 引用目標別名 rr 造成的 42P01。
-- 與現行 docs/058_session_courts_actual_court_numbers.sql 第 4 段「rounds / matches / sessions」邏輯一致，可單獨重跑。
--
-- 適用：已跑過 059、058 在 rounds UPDATE 失敗；或僅需補跑對應與同步 matches。
-- 可重複執行（依 sessions.metadata->058_court_physical_done 與 safe 條件）。

begin;

-- rounds：slot(sort_order)=court_no → 實體 session_courts.court_no
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

commit;
