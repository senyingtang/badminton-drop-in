-- 074_admin_delete_user_match_score_diagnostics.sql
-- Read-only diagnostics for admin hard-delete (match_score_submissions + blocking counts + audit logs).
-- No DDL/DML.

-- Target (edit these literals as needed)
--   email:  eric25035200724@gmail.com
--   user_id: 668bbc66-5aff-47d9-a6cf-16baa4876bce

-- 1) match_score_submissions columns
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'match_score_submissions'
order by ordinal_position;

-- 2) match_score_submissions FK + delete_rule
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  tc.constraint_name,
  ccu.table_schema as referenced_schema,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
  and rc.constraint_schema = tc.table_schema
where tc.constraint_type = 'foreign key'
  and tc.table_schema = 'public'
  and tc.table_name = 'match_score_submissions'
order by kcu.column_name;

-- 3) Resolve user by email (auth.users)
with u as (
  select id, email from auth.users where email = 'eric25035200724@gmail.com' limit 1
)
select * from u;

-- 4) Players owned by the user
with u as (
  select id from auth.users where email = 'eric25035200724@gmail.com' limit 1
)
select p.*
from public.players p
where p.auth_user_id = (select id from u)
order by p.created_at desc;

-- 5) match_score_submissions counts for the user (player-owned)
with u as (
  select id from auth.users where email = 'eric25035200724@gmail.com' limit 1
),
pids as (
  select array_agg(id) as ids from public.players where auth_user_id = (select id from u)
)
select
  (select count(*) from public.match_score_submissions where player_id = any (coalesce((select ids from pids), array[]::uuid[]))) as match_score_submissions_by_player_id;

-- 6) Blocking-related counts used by delete-preview (edit as needed)
with u as (
  select id from auth.users where email = 'eric25035200724@gmail.com' limit 1
),
pids as (
  select array_agg(id) as ids from public.players where auth_user_id = (select id from u)
),
personal_ba as (
  select id from public.kb_billing_accounts where owner_user_id = (select id from u) and account_type = 'personal' limit 1
),
personal_wallet as (
  select id, balance_cents from public.kb_wallets where billing_account_id = (select id from personal_ba) limit 1
)
select
  (select count(*) from auth.users where id = (select id from u)) as auth_users,
  (select count(*) from public.app_user_profiles where id = (select id from u)) as app_user_profiles,
  (select count(*) from public.user_role_memberships where user_id = (select id from u)) as user_role_memberships,
  (select count(*) from public.member_referral_profiles where user_id = (select id from u)) as member_referral_profiles,
  (select count(*) from public.member_referral_links where referrer_user_id = (select id from u)) as referral_links_as_referrer,
  (select count(*) from public.member_referral_links where referred_user_id = (select id from u)) as referral_links_as_referred,
  (select count(*) from public.players where auth_user_id = (select id from u)) as players,
  (select count(*) from public.session_participants where player_id = any (coalesce((select ids from pids), array[]::uuid[]))) as session_participants,
  (select count(*) from public.sessions where host_user_id = (select id from u)) as sessions_as_host,
  (select count(*) from public.sessions where created_by_user_id = (select id from u)) as sessions_as_creator,
  (select count(*) from public.kb_wallet_transactions where wallet_id = (select id from personal_wallet)) as kb_wallet_transactions,
  (select coalesce((select balance_cents from personal_wallet), 0)) as wallet_balance_cents,
  (select count(*) from public.kb_billing_events where user_id = (select id from u)) as kb_billing_events,
  (select count(*) from public.kb_subscriptions where billing_account_id = (select id from personal_ba)) as kb_subscriptions,
  (select count(*) from public.kb_payment_orders where user_id = (select id from u)) as kb_payment_orders,
  (select count(*) from public.match_score_submissions where player_id = any (coalesce((select ids from pids), array[]::uuid[]))) as match_score_submissions;

-- 7) kb_admin_audit_logs recent 30 (actor_user_id)
select id, created_at, actor_user_id, target_user_id, action, entity_type, entity_id, note
from public.kb_admin_audit_logs
order by created_at desc
limit 30;

-- 8) Confirm target user still exists in auth.users by explicit user_id literal
select id, email, created_at
from auth.users
where id = '668bbc66-5aff-47d9-a6cf-16baa4876bce';

