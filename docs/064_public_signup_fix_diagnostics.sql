-- 064_public_signup_fix_diagnostics.sql
-- 目的：驗證「registration_open 可公開報名」的最小修復是否已套用。
-- 注意：本檔僅查詢，不修改資料。

-- 1) 找出已 registration_open 且可公開報名的 sessions
select
  s.id,
  s.title,
  s.status,
  s.share_signup_code,
  s.allow_self_signup,
  s.host_user_id,
  s.venue_id,
  s.created_at
from public.sessions s
where s.status = 'registration_open'
  and s.allow_self_signup = true
  and s.share_signup_code is not null
order by s.created_at desc
limit 50;

-- 2) session_is_public_signup_visible 定義是否包含 registration_open
select
  p.oid::regprocedure as signature,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'session_is_public_signup_visible';

-- 3) get_public_session_roster_by_share_code 定義是否包含 registration_open
select
  p.oid::regprocedure as signature,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_public_session_roster_by_share_code';

-- 4) player_on_public_signup_roster 定義是否包含 registration_open
select
  p.oid::regprocedure as signature,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'player_on_public_signup_roster';

-- 5) sessions public select policy 是否包含 registration_open
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
from pg_policies
where schemaname = 'public'
  and tablename = 'sessions'
  and policyname ilike '%Public can view shared sessions%';

-- 6) venues 欄位列表（確認 address_text/city/district 是否存在）
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'venues'
order by ordinal_position;

-- 7) 最近 20 筆 sessions 核對
select
  s.id,
  s.title,
  s.status,
  s.share_signup_code,
  s.allow_self_signup,
  s.host_user_id,
  s.venue_id,
  s.created_at
from public.sessions s
order by s.created_at desc
limit 20;

