-- 052_open_registration_function_diagnostics.sql
-- Diagnose kb_open_registration_with_billing implementation & pricing sources.

-- 1) Function exists?
select p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'kb_open_registration_with_billing';

-- 2) Function body contains v_ent?
select position('v_ent' in pg_get_functiondef(p.oid)) as pos_v_ent
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'kb_open_registration_with_billing';

-- 3) Function body contains hardcoded 8000?
select position('8000' in pg_get_functiondef(p.oid)) as pos_8000
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'kb_open_registration_with_billing';

-- 4) Pricing source check: entitlements for free_wallet_only / personal_monthly_500
select
  p.plan_code,
  e.overage_price_cents,
  e.overage_price_twd,
  e.included_session_quota,
  e.monthly_quota_personal
from public.kb_plans p
left join public.kb_plan_entitlements e on e.plan_id = p.id
where p.plan_code in ('free_wallet_only','personal_monthly_500')
order by p.plan_code;

-- Expected:
-- - free_wallet_only.overage_price_cents = 8000
-- - personal_monthly_500.overage_price_cents = 5000

