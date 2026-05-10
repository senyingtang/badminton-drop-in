-- 075_commission_phase2_diagnostics.sql
-- Read-only: Phase 2 commission tables, RLS policies, referrers directory, audit tail.
-- No DDL/DML.

-- 1) commission_items columns + rows
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'commission_items'
order by ordinal_position;

select *
from public.commission_items
order by sort_order, item_key;

-- 2) commission_referrer_item_rates columns + sample
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'commission_referrer_item_rates'
order by ordinal_position;

select *
from public.commission_referrer_item_rates
order by created_at desc
limit 50;

-- 3) RLS enabled + policies: commission_items
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'commission_items';

select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy
where polrelid = 'public.commission_items'::regclass
order by polname;

-- 4) RLS enabled + policies: commission_referrer_item_rates
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'commission_referrer_item_rates';

select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy
where polrelid = 'public.commission_referrer_item_rates'::regclass
order by polname;

-- 5) Referrer directory (same shape as admin API)
with link_counts as (
  select referrer_user_id, count(*)::int as active_referral_links_count
  from public.member_referral_links
  where status = 'active'
  group by referrer_user_id
),
rate_counts as (
  select referrer_user_id, count(*)::int as personal_rate_overrides_count
  from public.commission_referrer_item_rates
  where is_active = true
  group by referrer_user_id
)
select
  m.user_id,
  au.email,
  p.display_name,
  p.primary_role,
  m.referral_code,
  m.is_active,
  m.created_at,
  coalesce(lc.active_referral_links_count, 0) as active_referral_links_count,
  coalesce(rc.personal_rate_overrides_count, 0) as personal_rate_overrides_count
from public.member_referral_profiles m
join public.app_user_profiles p on p.id = m.user_id
left join auth.users au on au.id = m.user_id
left join link_counts lc on lc.referrer_user_id = m.user_id
left join rate_counts rc on rc.referrer_user_id = m.user_id
order by m.created_at desc;

-- 6) Per referral_code: items + personal overrides (replace code literal)
with u as (
  select m.user_id
  from public.member_referral_profiles m
  where m.referral_code = 'YOUR_CODE_HERE'
  limit 1
)
select
  i.item_key,
  i.display_name,
  i.default_rate,
  r.rate as personal_rate,
  r.is_active as personal_override_active,
  r.note
from public.commission_items i
left join public.commission_referrer_item_rates r
  on r.commission_item_id = i.id
  and r.referrer_user_id = (select user_id from u)
order by i.sort_order, i.item_key;

-- 7) Recent commission-related kb_admin_audit_logs
select id, created_at, actor_user_id, target_user_id, action, entity_type, entity_id, note
from public.kb_admin_audit_logs
where action in ('commission_item_upsert', 'commission_referrer_rate_upsert')
   or entity_type in ('commission_items', 'commission_referrer_item_rates')
order by created_at desc
limit 50;
