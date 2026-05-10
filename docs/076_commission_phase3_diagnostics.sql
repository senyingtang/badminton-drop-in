-- 076_commission_phase3_diagnostics.sql
-- Read-only diagnostics for Phase 3 commission_events ledger.
-- No DDL/DML.

-- 1) commission_events columns
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'commission_events'
order by ordinal_position;

-- 2) commission_events enum types
select t.typname, e.enumlabel
from pg_type t
join pg_enum e on t.oid = e.enumtypid
where t.typname in ('commission_event_status', 'commission_event_type')
order by t.typname, e.enumsortorder;

-- 3) RLS policies on commission_events
select c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'commission_events';

select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy
where polrelid = 'public.commission_events'::regclass
order by polname;

-- 4) resolve_commission_rate exists
select proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'resolve_commission_rate';

-- 5) Example: summary for a referral_code in current month (replace code)
with u as (
  select m.user_id
  from public.member_referral_profiles m
  where m.referral_code = 'YOUR_CODE_HERE'
  limit 1
),
mstart as (
  select (date_trunc('month', now()::date))::date as d
)
select
  coalesce(sum(e.commission_amount_cents) filter (where e.status = 'effective'), 0) as estimated_commission_cents,
  count(*) filter (where e.status = 'effective') as effective_rows,
  count(*) filter (where e.event_type = 'adjustment') as adjustment_rows,
  count(*) filter (where e.status = 'voided') as voided_rows
from public.commission_events e
where e.referrer_user_id = (select user_id from u)
  and e.commission_month = (select d from mstart);

-- 6) Recent 50 commission_events
select id, created_at, commission_month, referrer_user_id, referred_user_id, commission_item_key,
       source_type, source_amount_cents, applied_rate, commission_amount_cents, event_type, status, note
from public.commission_events
order by created_at desc
limit 50;

-- 7) event_type / status counts
select event_type::text, status::text, count(*)::bigint as cnt
from public.commission_events
group by 1, 2
order by 1, 2;

-- 8) Commission-related audit logs
select id, created_at, actor_user_id, target_user_id, action, entity_type, entity_id, note
from public.kb_admin_audit_logs
where action in ('commission_event_manual_create', 'commission_event_void', 'commission_event_adjust')
order by created_at desc
limit 50;

-- 9) Suspected duplicate earned (same source + referrer + item)
select source_type, source_id, referrer_user_id, commission_item_key, count(*)::int as cnt
from public.commission_events
where source_id is not null and event_type = 'earned'
group by 1, 2, 3, 4
having count(*) > 1;
