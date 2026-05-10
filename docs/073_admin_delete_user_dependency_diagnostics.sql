-- 073_admin_delete_user_dependency_diagnostics.sql
-- Read-only: FK chains for admin user hard-delete planning.
-- No DDL/DML.

-- 1) FK referencing auth.users
-- ---------------------------------------------------------------------------
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  tc.constraint_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
  and tc.table_name = kcu.table_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
  and rc.constraint_schema = tc.table_schema
where tc.constraint_type = 'foreign key'
  and ccu.table_schema = 'auth'
  and ccu.table_name = 'users'
order by tc.table_schema, tc.table_name, kcu.column_name;

-- 2) FK referencing public.app_user_profiles
-- ---------------------------------------------------------------------------
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  tc.constraint_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
  and tc.table_name = kcu.table_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
  and rc.constraint_schema = tc.table_schema
where tc.constraint_type = 'foreign key'
  and ccu.table_schema = 'public'
  and ccu.table_name = 'app_user_profiles'
order by tc.table_schema, tc.table_name, kcu.column_name;

-- 3) Per-user counts (replace :target_email / literals)
-- ---------------------------------------------------------------------------
-- 3a resolve user id
with u as (
  select id from auth.users where email = 'eric25035200724@gmail.com' limit 1
),
pids as (
  select array_agg(id) as ids from public.players where auth_user_id = (select id from u)
)
select
  (select count(*) from auth.users where id = (select id from u)) as auth_users,
  (select count(*) from public.app_user_profiles where id = (select id from u)) as app_user_profiles,
  (select count(*) from public.user_role_memberships where user_id = (select id from u)) as user_role_memberships,
  (select count(*) from public.players where auth_user_id = (select id from u)) as players,
  (select count(*) from public.host_player_profiles where host_user_id = (select id from u)) as host_player_profiles_as_host,
  (select count(*) from public.host_player_profiles where player_id = any (coalesce((select ids from pids), array[]::uuid[]))) as host_player_profiles_as_player,
  (select count(*) from public.venue_host_memberships where host_user_id = (select id from u)) as venue_host_memberships,
  (select count(*) from public.member_referral_profiles where user_id = (select id from u)) as member_referral_profiles,
  (select count(*) from public.member_referral_links where referrer_user_id = (select id from u)) as referral_links_as_referrer,
  (select count(*) from public.member_referral_links where referred_user_id = (select id from u)) as referral_links_as_referred,
  (select count(*) from public.line_oa_binding_codes where player_id = any (coalesce((select ids from pids), array[]::uuid[]))) as line_oa_binding_codes,
  (select count(*) from public.kb_wallets w join public.kb_billing_accounts ba on ba.id = w.billing_account_id where ba.owner_user_id = (select id from u) and ba.account_type = 'personal') as kb_wallets,
  (select count(*) from public.kb_wallet_transactions wt join public.kb_wallets w on w.id = wt.wallet_id join public.kb_billing_accounts ba on ba.id = w.billing_account_id where ba.owner_user_id = (select id from u) and ba.account_type = 'personal') as kb_wallet_transactions,
  (select count(*) from public.kb_billing_events where user_id = (select id from u)) as kb_billing_events,
  (select count(*) from public.kb_subscriptions s join public.kb_billing_accounts ba on ba.id = s.billing_account_id where ba.owner_user_id = (select id from u) and ba.account_type = 'personal') as kb_subscriptions,
  (select count(*) from public.session_participants where player_id = any (coalesce((select ids from pids), array[]::uuid[]))) as session_participants,
  (select count(*) from public.sessions where host_user_id = (select id from u)) as sessions_as_host,
  (select count(*) from public.sessions where created_by_user_id = (select id from u)) as sessions_as_creator,
  (select count(*) from public.kb_payment_orders where user_id = (select id from u)) as kb_payment_orders;

-- 4) kb_admin_audit_logs columns
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'kb_admin_audit_logs'
order by ordinal_position;

-- 5) Summary: delete_rule counts for app_user_profiles FKs
-- ---------------------------------------------------------------------------
select rc.delete_rule, count(*) as cnt
from information_schema.table_constraints tc
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
where tc.constraint_type = 'foreign key'
  and ccu.table_schema = 'public'
  and ccu.table_name = 'app_user_profiles'
group by rc.delete_rule
order by rc.delete_rule;
