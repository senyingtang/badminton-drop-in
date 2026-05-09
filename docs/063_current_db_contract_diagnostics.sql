-- 063_current_db_contract_diagnostics.sql
-- 目的：在不假設欄位存在的前提下，快速檢查「目前 DB contract」。
-- 注意：本檔僅供診斷查詢（不修改資料、不建立 migration）。

-- 1) sessions 欄位列表
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sessions'
order by ordinal_position;

-- 2) sessions 最近 20 筆（用 to_jsonb(s)->>key 安全取欄位，不會因欄位不存在而爆）
select
  s.id,
  s.title,
  s.status,
  to_jsonb(s)->>'share_signup_code' as share_signup_code,
  to_jsonb(s)->>'share_code' as share_code,
  to_jsonb(s)->>'public_code' as public_code,
  to_jsonb(s)->>'signup_code' as signup_code,
  to_jsonb(s)->>'slug' as slug,
  to_jsonb(s)->>'booking_code' as booking_code,
  to_jsonb(s)->>'registration_opened_at' as registration_opened_at,
  to_jsonb(s)->>'billing_consumed_at' as billing_consumed_at,
  s.metadata,
  s.created_at
from public.sessions s
order by s.created_at desc
limit 20;

-- 3) sessions status 分佈
select status, count(*) as cnt
from public.sessions
group by status
order by cnt desc, status asc;

-- 4) session_courts 是否存在與欄位列表
select
  to_regclass('public.session_courts') is not null as session_courts_exists,
  coalesce(to_regclass('public.session_courts')::text, 'public.session_courts (missing)') as regclass_name;

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_courts'
order by ordinal_position;

-- 5) players 欄位列表（包含 LINE 相關欄位是否存在）
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'players'
order by ordinal_position;

-- 6) session_participants 欄位列表
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_participants'
order by ordinal_position;

-- 7) public signup RPC 是否存在（程式碼目前使用 self_signup_to_session_by_share_code）
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'self_signup_to_session_by_share_code',
    'signup_via_share_code',
    'get_public_session_roster_by_share_code',
    'get_public_pickup_group_prefs_by_share_code'
  )
order by p.proname, args;

-- 8) kb_open_registration_with_billing 是否存在
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'kb_open_registration_with_billing';

-- 9) RLS policy 列表（sessions / session_participants / players / session_courts）
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('sessions', 'session_participants', 'players', 'session_courts')
order by tablename, policyname;

