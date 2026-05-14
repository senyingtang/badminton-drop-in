-- 087_signup_failure_and_line_login_diagnostics.sql
-- 公開報名失敗與 LINE / LIFF 登入流程診斷（read-only）
-- 依環境調整 :share_code 或註解條件後執行。

-- 1) public_signup_error_logs 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'public_signup_error_logs'
order by ordinal_position;

-- 2) 最近 100 筆 signup / auth error logs
select id, created_at, flow, error_code, error_message,
       share_signup_code, session_id, user_id,
       left(coalesce(user_agent, ''), 120) as user_agent_preview
from public.public_signup_error_logs
order by created_at desc
limit 100;

-- 3) 依 error_code 統計（全表）
select error_code, count(*) as cnt
from public.public_signup_error_logs
group by error_code
order by cnt desc, error_code;

-- 4) 最近 24 小時
select id, created_at, flow, error_code, error_message, share_signup_code, session_id
from public.public_signup_error_logs
where created_at > now() - interval '24 hours'
order by created_at desc;

-- 5) 指定 share_signup_code（將 :share_code 換成實際分享碼）
-- select id, created_at, flow, error_code, error_message, session_id, user_id, error_detail
-- from public.public_signup_error_logs
-- where share_signup_code = :share_code
-- order by created_at desc;

-- 6) self signup / guest signup 相關 RPC 簽名（Postgres）
select p.proname as rpc_name,
       pg_get_function_identity_arguments(p.oid) as identity_args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'self_signup_to_session_by_share_code',
    'self_register_guest_friends_by_share_code'
  )
order by p.proname;

-- 7) sessions：share_signup_code 與狀態
select id, title, status, share_signup_code, allow_self_signup, created_at
from public.sessions
where share_signup_code is not null and trim(share_signup_code) <> ''
order by created_at desc
limit 200;

-- 8) allow_self_signup = false 但仍存在 share_signup_code（可能被分享）
select id, title, status, share_signup_code, allow_self_signup
from public.sessions
where coalesce(allow_self_signup, false) = false
  and share_signup_code is not null
  and trim(share_signup_code) <> ''
order by created_at desc
limit 200;

-- 9) status 非 registration_open 但有 share_signup_code
select id, title, status, share_signup_code, allow_self_signup
from public.sessions
where share_signup_code is not null
  and trim(share_signup_code) <> ''
  and status is distinct from 'registration_open'
order by created_at desc
limit 200;

-- 10) 最近成功報名 participants（依建立時間）
select sp.id, sp.created_at, sp.session_id, sp.display_name, sp.status,
       s.share_signup_code, s.title as session_title
from public.session_participants sp
join public.sessions s on s.id = sp.session_id
where sp.created_at > now() - interval '7 days'
order by sp.created_at desc
limit 100;

-- 11) LINE / LIFF / load_session / OAuth 相關 flow（共用 public_signup_error_logs）
select flow, error_code, count(*) as cnt
from public.public_signup_error_logs
where flow in (
  'line_start', 'line_callback', 'liff_entry', 'liff_line_login',
  'line_oauth_return', 'load_session', 'line_start_navigate',
  'ensure_player', 'cancel_guest'
)
   or left(error_code, 5) = 'LINE_'
   or left(error_code, 5) = 'LIFF_'
group by flow, error_code
order by cnt desc;
