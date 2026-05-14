-- 087_signup_failure_and_line_login_diagnostics.sql
-- 公開報名失敗與 LINE / LIFF 登入流程診斷（read-only）
-- 依環境調整條件後執行。若欄位與下列查詢不符，請先跑「0) Schema introspection」對照實際欄位。

-- =============================================================================
-- 0) Schema introspection（建議先跑；Production / repo 以 information_schema 為準）
-- =============================================================================

-- 0a) public.session_participants 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_participants'
order by ordinal_position;

-- 0b) public.players 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'players'
order by ordinal_position;

-- 0c) public.sessions 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sessions'
order by ordinal_position;

-- 0d) public.public_signup_error_logs 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_signup_error_logs'
order by ordinal_position;

-- =============================================================================
-- 1) 最近 100 筆 signup / auth error logs
-- =============================================================================
select id, created_at, flow, error_code, error_message,
       share_signup_code, session_id, user_id,
       left(coalesce(user_agent, ''), 120) as user_agent_preview
from public.public_signup_error_logs
order by created_at desc
limit 100;

-- 2) 依 error_code 統計（全表）
select error_code, count(*) as cnt
from public.public_signup_error_logs
group by error_code
order by cnt desc, error_code;

-- 3) 最近 24 小時
select id, created_at, flow, error_code, error_message, share_signup_code, session_id
from public.public_signup_error_logs
where created_at > now() - interval '24 hours'
order by created_at desc;

-- 4) 指定 share_signup_code（將 :share_code 換成實際分享碼）
-- select id, created_at, flow, error_code, error_message, session_id, user_id, error_detail
-- from public.public_signup_error_logs
-- where share_signup_code = :share_code
-- order by created_at desc;

-- 5) self signup / guest signup 相關 RPC 簽名（Postgres）
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

-- 6) sessions：share_signup_code 與狀態
select id, title, status, share_signup_code, allow_self_signup, created_at
from public.sessions
where share_signup_code is not null and trim(share_signup_code) <> ''
order by created_at desc
limit 200;

-- 7) allow_self_signup = false 但仍存在 share_signup_code（可能被分享）
select id, title, status, share_signup_code, allow_self_signup
from public.sessions
where coalesce(allow_self_signup, false) = false
  and share_signup_code is not null
  and trim(share_signup_code) <> ''
order by created_at desc
limit 200;

-- 8) status 非 registration_open 但有 share_signup_code
select id, title, status, share_signup_code, allow_self_signup
from public.sessions
where share_signup_code is not null
  and trim(share_signup_code) <> ''
  and status is distinct from 'registration_open'
order by created_at desc
limit 200;

-- 9) 最近成功報名 participants（依建立時間）
-- 說明：session_participants 無 display_name；公開／名單顯示用 guest_display_name、session_display_name，
--       否則 fallback players.display_name（repo / Production 皆為 display_name）。
select
  sp.id,
  sp.created_at,
  sp.session_id,
  s.title as session_title,
  sp.status,
  sp.player_id,
  coalesce(
    nullif(trim(sp.guest_display_name), ''),
    nullif(trim(sp.session_display_name), ''),
    p.display_name
  ) as display_name,
  sp.is_guest_registration,
  sp.guest_display_name,
  sp.session_display_name,
  sp.guest_level,
  sp.self_level,
  sp.registered_by_user_id,
  sp.notification_user_id
from public.session_participants sp
left join public.players p
  on p.id = sp.player_id
left join public.sessions s
  on s.id = sp.session_id
where sp.created_at > now() - interval '7 days'
order by sp.created_at desc
limit 50;

-- 10) 正選（或候補轉正）但「該列 player」無 LINE OA / LINE Login UID（團主聯絡／推播可能 LINE_NOT_BOUND）
-- 說明：此段檢查的是 sp.player_id 對應之 players；代報名若通知改走 notification_user_id，請併看第 12、13 段。
select sp.id as session_participant_id,
       sp.session_id,
       sp.status,
       sp.is_guest_registration,
       sp.notification_user_id,
       sp.registered_by_user_id,
       coalesce(
         nullif(trim(sp.guest_display_name), ''),
         nullif(trim(sp.session_display_name), ''),
         p.display_name
       ) as display_name,
       p.line_oa_user_id,
       p.line_user_id
from public.session_participants sp
join public.players p on p.id = sp.player_id
where sp.is_removed = false
  and sp.status in ('confirmed_main', 'promoted_from_waitlist')
  and coalesce(nullif(trim(p.line_oa_user_id), ''), nullif(trim(p.line_user_id), '')) is null
order by sp.created_at desc
limit 100;

-- 11) 代報名 participant 與 notification_user_id
select sp.id,
       sp.session_id,
       sp.is_guest_registration,
       sp.notification_user_id,
       sp.registered_by_user_id,
       sp.guest_display_name,
       sp.guest_level
from public.session_participants sp
where sp.is_removed = false
  and sp.is_guest_registration = true
order by sp.created_at desc
limit 50;

-- 12) notification_user_id（app_user_profiles.id）對應 player 之 LINE 欄位（代報收件者）
-- 說明：081 將 notification_user_id FK 指向 app_user_profiles(id)；players 以 auth_user_id 對應同一使用者。
select sp.id as session_participant_id,
       sp.notification_user_id,
       pl.id as notify_player_id,
       pl.display_name as notify_player_display_name,
       pl.line_oa_user_id,
       pl.line_user_id
from public.session_participants sp
left join public.app_user_profiles ap on ap.id = sp.notification_user_id
left join public.players pl on pl.auth_user_id = ap.id
where sp.is_removed = false
  and sp.is_guest_registration = true
  and sp.notification_user_id is not null
order by sp.created_at desc
limit 50;

-- 13) 正選名單可推播 / 不可推播人數（依場次；recipient：代報且設 notification 時僅看代報者 nu_pl，否則看該列 player p）
-- 說明：可推播 = 收件者 player 的 line_oa_user_id 或 line_user_id 至少一個非空白。
select
  sp.session_id,
  s.title as session_title,
  count(*) filter (where
    case
      when sp.is_guest_registration and sp.notification_user_id is not null then
        coalesce(
          nullif(trim(nu_pl.line_oa_user_id), ''),
          nullif(trim(nu_pl.line_user_id), '')
        ) is not null
      else
        coalesce(
          nullif(trim(p.line_oa_user_id), ''),
          nullif(trim(p.line_user_id), '')
        ) is not null
    end
  ) as pushable_main_cnt,
  count(*) filter (where
    case
      when sp.is_guest_registration and sp.notification_user_id is not null then
        coalesce(
          nullif(trim(nu_pl.line_oa_user_id), ''),
          nullif(trim(nu_pl.line_user_id), '')
        ) is null
      else
        coalesce(
          nullif(trim(p.line_oa_user_id), ''),
          nullif(trim(p.line_user_id), '')
        ) is null
    end
  ) as not_pushable_main_cnt
from public.session_participants sp
join public.sessions s on s.id = sp.session_id
join public.players p on p.id = sp.player_id
left join public.app_user_profiles ap_nu on ap_nu.id = sp.notification_user_id
left join public.players nu_pl on nu_pl.auth_user_id = ap_nu.id
where sp.is_removed = false
  and sp.status in ('confirmed_main', 'promoted_from_waitlist')
  and sp.created_at > now() - interval '30 days'
group by sp.session_id, s.title
having count(*) > 0
order by sp.session_id desc;

-- 14) LINE / LIFF / load_session / OAuth 相關 flow（共用 public_signup_error_logs）
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
