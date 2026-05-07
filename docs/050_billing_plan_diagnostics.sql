-- 050_billing_plan_diagnostics.sql
-- Run in Supabase SQL Editor to diagnose billing plan + RPC state.

-- 1) Plan rows
select plan_code, plan_name, plan_type, price_twd, monthly_price_cents, description, is_active
from public.kb_plans
where plan_code in ('free_wallet_only','personal_monthly_500')
order by plan_code;

-- 2) Entitlements existence + key columns
select to_regclass('public.kb_plan_entitlements') as kb_plan_entitlements_regclass;

-- 3) Entitlements columns list (if exists)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'kb_plan_entitlements'
order by ordinal_position;

-- 4) Entitlements values for these plans (if table exists)
select
  p.plan_code,
  e.monthly_quota_personal,
  e.included_session_quota,
  e.overage_price_twd,
  e.overage_price_cents,
  e.created_at,
  e.updated_at
from public.kb_plans p
left join public.kb_plan_entitlements e on e.plan_id = p.id
where p.plan_code in ('free_wallet_only','personal_monthly_500')
order by p.plan_code;

-- 5) RPC exists?
select p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('kb_open_registration_with_billing','charge_session_first_start','lock_round_and_increment_counters')
order by p.proname;

-- 6) Sessions columns needed by new flow
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'sessions'
  and column_name in ('billing_consumed_at','registration_opened_at','billing_event_id','billing_charged_by')
order by column_name;

-- 7) Quick check: does kb_open_registration_with_billing contain hardcoded 8000?
-- (If this returns rows, you still have hardcode and should re-apply 049/050 patches properly.)
select p.proname, position('8000' in pg_get_functiondef(p.oid)) as pos_8000
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'kb_open_registration_with_billing'
  and position('8000' in pg_get_functiondef(p.oid)) > 0;

-- 8) Ensure legacy charge is not referenced by lock round function
select p.proname, position('charge_session_first_start' in pg_get_functiondef(p.oid)) as pos_legacy
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'lock_round_and_increment_counters'
  and position('charge_session_first_start' in pg_get_functiondef(p.oid)) > 0;

