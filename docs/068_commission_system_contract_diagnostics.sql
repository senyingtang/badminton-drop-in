-- 068_commission_system_contract_diagnostics.sql
-- Phase 0: READ-ONLY diagnostics for commission / referral / billing contract discovery.
-- Rules: SELECT / information_schema / pg_catalog only. No DDL/DML.

-- =============================================================================
-- 1) Columns: user / profile / role related tables
-- =============================================================================
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'app_user_profiles',
    'user_role_memberships',
    'players',
    'host_player_profiles',
    'venue_host_memberships'
  )
order by table_name, ordinal_position;

-- =============================================================================
-- 2) Recent profiles (last 20): user id, email, display_name, role, player_id
--     Requires: SELECT on auth.users (Supabase SQL editor typically ok).
-- =============================================================================
select
  aup.id as user_id,
  au.email,
  aup.display_name,
  aup.primary_role,
  p.id as player_id,
  aup.created_at
from public.app_user_profiles aup
left join auth.users au on au.id = aup.id
left join public.players p on p.auth_user_id = aup.id
order by aup.created_at desc
limit 20;

-- =============================================================================
-- 3) Columns: billing / wallet / subscription related tables
--     Note: kb_payments may not exist in this project; query returns 0 rows if absent.
-- =============================================================================
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'kb_wallets',
    'kb_wallet_transactions',
    'kb_billing_events',
    'kb_subscriptions',
    'kb_plan_entitlements',
    'kb_payments',
    'kb_payment_orders',
    'kb_quota_buckets',
    'kb_quota_ledger',
    'kb_billing_accounts'
  )
order by table_name, ordinal_position;

-- =============================================================================
-- 4) Recent billing events (30)
-- =============================================================================
select *
from public.kb_billing_events
order by created_at desc
limit 30;

-- =============================================================================
-- 5) Recent wallet transactions (30)
-- =============================================================================
select *
from public.kb_wallet_transactions
order by created_at desc
limit 30;

-- =============================================================================
-- 6) Recent subscriptions (30)
-- =============================================================================
select *
from public.kb_subscriptions
order by created_at desc
limit 30;

-- =============================================================================
-- 7) Functions / RPC (billing / wallet / open registration / payment keywords)
-- =============================================================================
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%kb_open_registration%'
    or p.proname ilike '%kb_wallet%'
    or p.proname ilike '%billing%'
    or p.proname ilike '%payment%'
    or p.proname ilike '%subscription%'
    or p.proname ilike '%quota%'
    or p.proname ilike '%topup%'
    or p.proname ilike '%ecpay%'
  )
order by p.proname;

-- =============================================================================
-- 8) RLS policies (selected tables)
-- =============================================================================
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
  and tablename in (
    'app_user_profiles',
    'players',
    'kb_wallets',
    'kb_wallet_transactions',
    'kb_billing_events',
    'kb_subscriptions'
  )
order by tablename, policyname;

-- =============================================================================
-- 9) Audit-related tables (existence + columns)
-- =============================================================================
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'kb_admin_audit_logs',
    'kb_audit_logs',
    'kb_session_events',
    'audit_logs'
  )
order by table_name, ordinal_position;

-- =============================================================================
-- 10) Storage buckets (Supabase: storage schema exists; self-hosted may omit)
-- =============================================================================
select exists(
  select 1 from information_schema.schemata s where s.schema_name = 'storage'
) as storage_schema_exists;

select *
from information_schema.tables
where table_schema = 'storage'
  and table_name in ('buckets', 'objects');

-- If the above shows storage.buckets, list buckets (may error on non-Supabase DBs; comment out if needed):
select *
from storage.buckets
order by created_at desc nulls last;
