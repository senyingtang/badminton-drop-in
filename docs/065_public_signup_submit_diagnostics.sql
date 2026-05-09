-- 065_public_signup_submit_diagnostics.sql
-- 目的：診斷「送出報名」RPC 與資料現況（僅查詢、不修改資料）。

-- 1) 最近 20 筆 sessions（欄位名稱以 base schema 為主；max_players 若不存在請忽略）
select
  s.id,
  s.title,
  s.status,
  s.share_signup_code,
  s.allow_self_signup,
  to_jsonb(s)->>'max_players' as max_players,
  s.created_at
from public.sessions s
order by s.created_at desc
limit 20;

-- 2) 可公開報名（registration_open）的 sessions
select
  s.id,
  s.title,
  s.status,
  s.share_signup_code,
  s.allow_self_signup,
  s.created_at
from public.sessions s
where s.status = 'registration_open'
  and s.allow_self_signup = true
  and s.share_signup_code is not null
order by s.created_at desc
limit 50;

-- 3) 實際送出報名 RPC definition（self_signup_to_session_by_share_code）
select
  p.oid::regprocedure as signature,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'self_signup_to_session_by_share_code';

-- 4) 檢查 definition 是否包含 registration_open（快速用文字判斷）
select
  position('registration_open' in pg_get_functiondef(p.oid)) > 0 as includes_registration_open
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'self_signup_to_session_by_share_code'
limit 1;

-- 5) session_participants 最近 20 筆
select
  sp.id,
  sp.session_id,
  sp.player_id,
  sp.source_type,
  sp.status,
  sp.waitlist_order,
  sp.session_display_name,
  sp.created_at
from public.session_participants sp
order by sp.created_at desc
limit 20;

-- 6) players 最近 20 筆
select
  p.id,
  p.auth_user_id,
  p.player_code,
  p.display_name,
  to_jsonb(p)->>'line_oa_user_id' as line_oa_user_id,
  to_jsonb(p)->>'line_user_id' as line_user_id,
  p.created_at
from public.players p
order by p.created_at desc
limit 20;

-- 7) session_participant_status_type enum 可用值
select unnest(enum_range(null::public.session_participant_status_type))::text as status_value;

