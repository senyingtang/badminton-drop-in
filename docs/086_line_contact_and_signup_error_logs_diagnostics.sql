-- 086_line_contact_and_signup_error_logs_diagnostics.sql
-- 報名失敗 log、LINE 聯絡／廣播 audit 檢查用

-- 1) public_signup_error_logs 欄位
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_signup_error_logs'
order by ordinal_position;

-- 2) 最近 50 筆報名失敗
select id, created_at, error_code, error_message, share_signup_code, session_id, user_id, flow
from public.public_signup_error_logs
order by created_at desc
limit 50;

-- 3) 依 error_code 統計（最近 7 天）
select error_code, count(*) as cnt
from public.public_signup_error_logs
where created_at > now() - interval '7 days'
group by error_code
order by cnt desc;

-- 4) 指定 share_signup_code 的失敗（請替換 :code）
-- select *
-- from public.public_signup_error_logs
-- where share_signup_code ilike :code
-- order by created_at desc
-- limit 100;

-- 5) 正選但 players 無 LINE UID（團主聯絡／廣播可能 LINE_NOT_BOUND）
select sp.id as session_participant_id,
       sp.session_id,
       sp.status,
       sp.is_guest_registration,
       sp.notification_user_id,
       sp.registered_by_user_id,
       p.line_oa_user_id,
       p.line_user_id
from public.session_participants sp
join public.players p on p.id = sp.player_id
where sp.is_removed = false
  and sp.status in ('confirmed_main', 'promoted_from_waitlist')
  and coalesce(nullif(trim(p.line_oa_user_id), ''), nullif(trim(p.line_user_id), '')) is null
order by sp.created_at desc
limit 100;

-- 6) 代報名 participant 的 notification_user_id
select sp.id,
       sp.session_id,
       sp.is_guest_registration,
       sp.notification_user_id,
       sp.registered_by_user_id,
       sp.guest_display_name
from public.session_participants sp
where sp.is_removed = false
  and sp.is_guest_registration = true
order by sp.created_at desc
limit 50;

-- 7) notification_user_id 對應的 LINE UID（代報收件者）
select sp.id as session_participant_id,
       sp.notification_user_id,
       pl.line_oa_user_id,
       pl.line_user_id
from public.session_participants sp
left join public.players pl on pl.auth_user_id = sp.notification_user_id
where sp.is_removed = false
  and sp.is_guest_registration = true
  and sp.notification_user_id is not null
order by sp.created_at desc
limit 50;

-- 8) 聯絡／廣播 audit（kb_admin_audit_logs）
select id, created_at, actor_user_id, action, entity_type, entity_id, after_data
from public.kb_admin_audit_logs
where action in ('session_participant_contact_message', 'session_participant_broadcast_message')
order by created_at desc
limit 50;
