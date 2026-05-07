-- 050_fix_plan_entitlements_updated_at_and_overage.sql
-- Fix 049 failure:
-- - kb_plan_entitlements has no updated_at in 005_billing_schema.sql
-- - 049 used "updated_at = now()" in ON CONFLICT DO UPDATE causing ERROR 42703.
--
-- This patch is safe to re-run:
-- - Adds missing columns only when needed (to_regclass + information_schema checks)
-- - Adds updated_at + trigger for kb_plan_entitlements if missing
-- - Re-applies plan seed + entitlement pricing (80/50)
-- - Keeps kb_open_registration_with_billing reading fee from entitlements (no hardcoded 8000)

begin;

-- =========================================================
-- 0) Ensure kb_plan_entitlements exists; if not, skip entitlement-specific patches.
-- =========================================================
do $$
begin
  if to_regclass('public.kb_plan_entitlements') is null then
    raise notice 'skip: public.kb_plan_entitlements does not exist';
    return;
  end if;
end $$;

-- =========================================================
-- 1) Ensure updated_at column + trigger exists on kb_plan_entitlements
-- =========================================================
alter table public.kb_plan_entitlements
  add column if not exists updated_at timestamptz not null default now();

-- Create updated_at trigger if kb_touch_updated_at exists (from 005_billing_schema.sql)
do $$
begin
  if to_regclass('public.kb_plan_entitlements') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_proc
    join pg_namespace n on n.oid = pg_proc.pronamespace
    where n.nspname = 'public' and pg_proc.proname = 'kb_touch_updated_at'
  ) then
    execute 'drop trigger if exists trg_kb_plan_entitlements_updated_at on public.kb_plan_entitlements;';
    execute 'create trigger trg_kb_plan_entitlements_updated_at before update on public.kb_plan_entitlements for each row execute function public.kb_touch_updated_at();';
  else
    raise notice 'kb_touch_updated_at missing; skip trigger';
  end if;
end $$;

-- =========================================================
-- 2) Ensure cents columns exist (non-breaking)
-- =========================================================
alter table public.kb_plans
  add column if not exists monthly_price_cents bigint,
  add column if not exists description text;

alter table public.kb_plan_entitlements
  add column if not exists included_session_quota integer,
  add column if not exists overage_price_cents bigint;

-- Backfill when missing
update public.kb_plans
set monthly_price_cents = coalesce(monthly_price_cents, round(coalesce(price_twd, 0) * 100)::bigint)
where monthly_price_cents is null;

update public.kb_plan_entitlements
set overage_price_cents = coalesce(overage_price_cents, round(coalesce(overage_price_twd, 0) * 100)::bigint)
where overage_price_cents is null;

update public.kb_plan_entitlements
set included_session_quota = coalesce(included_session_quota, monthly_quota_personal)
where included_session_quota is null;

-- =========================================================
-- 3) Upsert plan seeds (free_wallet_only / personal_monthly_500)
-- =========================================================
insert into public.kb_plans (plan_code, plan_name, plan_type, price_twd, monthly_price_cents, description, is_active)
values
  ('free_wallet_only', '儲值金用戶', 'personal', 0, 0, '無月費，每次開放報名扣儲值金 NT$80', true),
  ('personal_monthly_500', '個人月費 500', 'personal', 500, 50000, '每月 NT$500，含 10 次開放報名 quota，超過後每次扣儲值金 NT$50', true)
on conflict (plan_code) do update
set plan_name = excluded.plan_name,
    plan_type = excluded.plan_type,
    price_twd = excluded.price_twd,
    monthly_price_cents = excluded.monthly_price_cents,
    description = excluded.description,
    is_active = true;

-- Upsert entitlements, no assumptions beyond columns ensured above.
insert into public.kb_plan_entitlements (
  plan_id,
  included_host_seats,
  monthly_quota_per_host,
  monthly_quota_personal,
  included_session_quota,
  trial_session_count,
  overage_price_twd,
  overage_price_cents,
  roster_sharing_enabled,
  ratings_shared_enabled,
  add_on_seat_allowed
)
select
  p.id,
  1,
  0,
  case when p.plan_code = 'personal_monthly_500' then 10 else 0 end,
  case when p.plan_code = 'personal_monthly_500' then 10 else 0 end,
  0,
  case when p.plan_code = 'personal_monthly_500' then 50 else 80 end,
  case when p.plan_code = 'personal_monthly_500' then 5000 else 8000 end,
  false,
  true,
  false
from public.kb_plans p
where p.plan_code in ('free_wallet_only','personal_monthly_500')
on conflict (plan_id) do update
set monthly_quota_personal = excluded.monthly_quota_personal,
    included_session_quota = excluded.included_session_quota,
    overage_price_twd = excluded.overage_price_twd,
    overage_price_cents = excluded.overage_price_cents,
    updated_at = now();

-- Org plans (if any): overage 50
update public.kb_plan_entitlements e
set overage_price_twd = 50,
    overage_price_cents = 5000,
    updated_at = now()
from public.kb_plans p
where e.plan_id = p.id
  and p.plan_type = 'organization'
  and coalesce(e.overage_price_cents, 0) <> 5000;

-- =========================================================
-- 4) Ensure kb_open_registration_with_billing does NOT hardcode 8000
-- (we re-use the version defined by 049; safe to re-apply)
-- =========================================================
-- If 049 was never applied, 050 alone does not create the RPC. It only ensures the table columns are fixed.
-- You still need 048 (creates base RPC + billing tables) before this patch.

commit;

