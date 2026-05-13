-- 083_session_operations_reports_diagnostics.sql
-- Read-only: session_operation_reports + sessions 欄位與名單計數。

-- 1) session_operation_reports 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_operation_reports'
order by ordinal_position;

-- 2) sessions 與報名／費用相關欄位（fee_twd、max_participants 等）
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sessions'
  and column_name in (
    'id', 'host_user_id', 'venue_id', 'title', 'status', 'start_at', 'end_at',
    'fee_twd', 'max_participants', 'metadata', 'allow_self_signup'
  )
order by ordinal_position;

-- 3) 最近已結束場次
select id, title, host_user_id, status, start_at, fee_twd, max_participants
from public.sessions
where status = 'session_finished'
order by start_at desc
limit 20;

-- 4) 每場 confirmed_main 人數（未移除）
select sp.session_id,
       count(*) filter (
         where sp.is_removed = false and sp.status = 'confirmed_main'
       ) as confirmed_main_count
from public.session_participants sp
group by sp.session_id
having count(*) filter (where sp.is_removed = false and sp.status = 'confirmed_main') > 0
order by max(sp.created_at) desc
limit 30;

-- 5) 每場是否已有未刪除營運報表
select s.id as session_id,
       s.title,
       s.status,
       r.id as report_id,
       r.net_revenue_cents,
       r.deleted_at
from public.sessions s
left join public.session_operation_reports r
  on r.session_id = s.id
 and r.deleted_at is null
where s.status = 'session_finished'
order by s.start_at desc
limit 30;

-- 6) 重複 active report 風險（應為 0）
select session_id, count(*) as n
from public.session_operation_reports
where deleted_at is null
group by session_id
having count(*) > 1;

-- 7) soft deleted reports
select id, session_id, host_user_id, deleted_at, deleted_by_user_id
from public.session_operation_reports
where deleted_at is not null
order by deleted_at desc
limit 20;

-- 8) 最近 audit（營運報表相關）
select id, action, actor_user_id, entity_type, entity_id, note, created_at
from public.kb_admin_audit_logs
where action in (
  'session_operation_report_create',
  'session_operation_report_update',
  'session_operation_report_delete',
  'session_end_with_operation_report',
  'session_operation_report_backfill_create'
)
order by created_at desc
limit 40;

-- 9) 已結束但尚無未刪除營運報表（補建立候選）
select s.id as session_id,
       s.title,
       s.start_at,
       s.host_user_id,
       s.fee_twd,
       s.max_participants
from public.sessions s
where s.status = 'session_finished'
  and not exists (
    select 1 from public.session_operation_reports r
    where r.session_id = s.id and r.deleted_at is null
  )
order by s.start_at desc
limit 50;
