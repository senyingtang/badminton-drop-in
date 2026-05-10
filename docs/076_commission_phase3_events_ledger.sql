-- 076_commission_phase3_events_ledger.sql
-- Phase 3: commission_events ledger + resolve_commission_rate + RLS.
-- Run in Supabase SQL Editor after 075. Idempotent where possible.
-- No webhook / payout / hard delete.

begin;

-- ---------------------------------------------------------------------------
-- 1) Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.commission_event_status as enum ('pending', 'effective', 'voided', 'adjusted');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.commission_event_type as enum ('earned', 'adjustment', 'reversal');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Table commission_events
-- ---------------------------------------------------------------------------
create table if not exists public.commission_events (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.app_user_profiles (id) on delete restrict,
  referred_user_id uuid references public.app_user_profiles (id) on delete set null,
  referral_link_id uuid references public.member_referral_links (id) on delete set null,
  commission_item_id uuid references public.commission_items (id) on delete set null,
  commission_item_key text not null,
  commission_item_display_name text not null,
  source_type text not null,
  source_id uuid,
  source_external_id text,
  source_occurred_at timestamptz not null default now(),
  source_amount_cents bigint not null default 0,
  currency text not null default 'TWD',
  applied_rate numeric(6, 4) not null default 0,
  commission_amount_cents bigint not null default 0,
  event_type public.commission_event_type not null default 'earned',
  status public.commission_event_status not null default 'effective',
  commission_month date not null,
  referrer_referral_code text,
  referrer_email_snapshot text,
  referred_email_snapshot text,
  source_snapshot jsonb not null default '{}'::jsonb,
  rate_snapshot jsonb not null default '{}'::jsonb,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  voided_at timestamptz,
  voided_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  void_reason text,
  adjusted_from_event_id uuid references public.commission_events (id) on delete set null,
  created_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_commission_events_source_amount_nonneg check (source_amount_cents >= 0),
  constraint chk_commission_events_applied_rate check (applied_rate >= 0 and applied_rate <= 1),
  constraint chk_commission_events_commission_month_first_day check (
    commission_month = (date_trunc('month', commission_month::timestamp))::date
  ),
  constraint chk_commission_events_earned_source_positive check (
    event_type is distinct from 'earned'::public.commission_event_type
    or source_amount_cents > 0
  )
);

drop trigger if exists trg_commission_events_updated_at on public.commission_events;
create trigger trg_commission_events_updated_at
before update on public.commission_events
for each row execute function public.set_updated_at();

create index if not exists idx_commission_events_referrer_month on public.commission_events (referrer_user_id, commission_month);
create index if not exists idx_commission_events_referred on public.commission_events (referred_user_id);
create index if not exists idx_commission_events_referral_link on public.commission_events (referral_link_id);
create index if not exists idx_commission_events_item_key on public.commission_events (commission_item_key);
create index if not exists idx_commission_events_status on public.commission_events (status);
create index if not exists idx_commission_events_source on public.commission_events (source_type, source_id);
create index if not exists idx_commission_events_created on public.commission_events (created_at desc);

-- Dedupe earned rows with same business source (optional safety)
create unique index if not exists ux_commission_events_source_dedupe
  on public.commission_events (source_type, source_id, referrer_user_id, commission_item_key)
  where source_id is not null and event_type = 'earned'::public.commission_event_type;

-- ---------------------------------------------------------------------------
-- 3) resolve_commission_rate
-- ---------------------------------------------------------------------------
create or replace function public.resolve_commission_rate(
  p_referrer_user_id uuid,
  p_commission_item_key text
)
returns table (
  commission_item_id uuid,
  commission_item_key text,
  display_name text,
  default_rate numeric,
  personal_rate numeric,
  applied_rate numeric,
  personal_rate_active boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_item public.commission_items%rowtype;
  v_personal numeric;
  v_has_personal boolean := false;
begin
  select * into v_item from public.commission_items i where i.item_key = p_commission_item_key limit 1;
  if not found then
    commission_item_id := null;
    commission_item_key := null;
    display_name := null;
    default_rate := null;
    personal_rate := null;
    applied_rate := null;
    personal_rate_active := false;
    return next;
    return;
  end if;

  select r.rate into v_personal
  from public.commission_referrer_item_rates r
  where r.referrer_user_id = p_referrer_user_id
    and r.commission_item_id = v_item.id
    and r.is_active = true
  limit 1;

  v_has_personal := found;

  commission_item_id := v_item.id;
  commission_item_key := v_item.item_key;
  display_name := v_item.display_name;
  default_rate := v_item.default_rate;
  personal_rate := case when v_has_personal then v_personal else null end;
  personal_rate_active := v_has_personal and v_item.is_active;

  if not v_item.is_active then
    applied_rate := null;
    personal_rate_active := false;
  elsif v_has_personal then
    applied_rate := v_personal;
  else
    applied_rate := v_item.default_rate;
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Admin summary helper (optional; used by GET /api/admin/commissions/events)
-- ---------------------------------------------------------------------------
create or replace function public.commission_events_admin_summary(
  p_commission_month date,
  p_referrer_user_id uuid,
  p_referred_user_id uuid,
  p_commission_item_key text,
  p_status text,
  p_event_type text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_effective_total bigint;
  v_adjustment_total bigint;
  v_voided_total bigint;
  v_event_count bigint;
  v_effective_count bigint;
  v_voided_count bigint;
  v_adjusted_count bigint;
begin
  select
    coalesce(sum(commission_amount_cents) filter (where status = 'effective'::public.commission_event_status and event_type = 'earned'::public.commission_event_type), 0),
    coalesce(sum(commission_amount_cents) filter (where status = 'effective'::public.commission_event_status and event_type = 'adjustment'::public.commission_event_type), 0),
    coalesce(sum(commission_amount_cents) filter (where status = 'voided'::public.commission_event_status), 0),
    count(*)::bigint,
    count(*) filter (where status = 'effective'::public.commission_event_status)::bigint,
    count(*) filter (where status = 'voided'::public.commission_event_status)::bigint,
    count(*) filter (where event_type = 'adjustment'::public.commission_event_type)::bigint
  into
    v_effective_total,
    v_adjustment_total,
    v_voided_total,
    v_event_count,
    v_effective_count,
    v_voided_count,
    v_adjusted_count
  from public.commission_events e
  where (p_commission_month is null or e.commission_month = p_commission_month)
    and (p_referrer_user_id is null or e.referrer_user_id = p_referrer_user_id)
    and (p_referred_user_id is null or e.referred_user_id = p_referred_user_id)
    and (p_commission_item_key is null or e.commission_item_key = p_commission_item_key)
    and (p_status is null or e.status::text = p_status)
    and (p_event_type is null or e.event_type::text = p_event_type);

  return jsonb_build_object(
    'effective_total_cents', v_effective_total,
    'adjustment_total_cents', v_adjustment_total,
    'voided_total_cents', v_voided_total,
    'event_count', v_event_count,
    'effective_count', v_effective_count,
    'voided_count', v_voided_count,
    'adjusted_count', v_adjusted_count
  );
end;
$$;

grant execute on function public.resolve_commission_rate(uuid, text) to authenticated, service_role;
grant execute on function public.commission_events_admin_summary(date, uuid, uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
alter table public.commission_events enable row level security;

drop policy if exists "Referrer can select own commission_events" on public.commission_events;
create policy "Referrer can select own commission_events"
  on public.commission_events
  for select
  using (referrer_user_id = auth.uid());

drop policy if exists "Platform admin select commission_events" on public.commission_events;
create policy "Platform admin select commission_events"
  on public.commission_events
  for select
  using (public.is_platform_admin());

drop policy if exists "Platform admin insert commission_events" on public.commission_events;
create policy "Platform admin insert commission_events"
  on public.commission_events
  for insert
  with check (public.is_platform_admin());

drop policy if exists "Platform admin update commission_events" on public.commission_events;
create policy "Platform admin update commission_events"
  on public.commission_events
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

commit;
