-- 048_billing_open_registration_wallet_subscription.sql
-- Goal:
-- - Billing consumption moved to "open registration" time point.
-- - Introduce kb_open_registration_with_billing(p_session_id uuid) as the single charging入口.
-- - Prepare wallet topup / payment gateway / subscription tables & configs.
--
-- Notes:
-- - Legacy wallet tables (wallet_accounts / wallet_transactions) remain but are NOT used by new flow.
-- - Existing kb_* billing schema (005) is extended (non-destructive).

begin;

-- =========================================================
-- 0) Session status: add registration_open
-- =========================================================
do $$
begin
  alter type public.session_status_type add value if not exists 'registration_open';
exception when duplicate_object then null;
end $$;

-- =========================================================
-- 1) Sessions: add registration billing fields
-- =========================================================
alter table public.sessions
  add column if not exists registration_opened_at timestamptz,
  add column if not exists billing_consumed_at timestamptz,
  add column if not exists billing_charged_by text, -- 'quota' | 'wallet'
  add column if not exists billing_event_id uuid;

create index if not exists idx_sessions_registration_opened_at on public.sessions(registration_opened_at);

-- =========================================================
-- 2) Wallet cents model (extend existing kb_wallets / kb_wallet_transactions)
-- =========================================================
alter table public.kb_wallets
  add column if not exists balance_cents bigint not null default 0;

-- backfill from legacy numeric balance (TWD) if balance_cents not yet set
update public.kb_wallets
set balance_cents = greatest(coalesce(round(balance * 100)::bigint, 0), 0)
where (balance_cents is null or balance_cents = 0)
  and balance is not null;

do $$ begin
  create type public.kb_wallet_txn_direction as enum ('credit','debit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kb_wallet_txn_reason as enum (
    'topup',
    'session_registration',
    'refund',
    'manual_adjustment',
    'subscription_overage'
  );
exception when duplicate_object then null; end $$;

alter table public.kb_wallet_transactions
  add column if not exists user_id uuid,
  add column if not exists organization_id uuid,
  add column if not exists amount_cents bigint,
  add column if not exists direction public.kb_wallet_txn_direction,
  add column if not exists reason public.kb_wallet_txn_reason,
  add column if not exists balance_after_cents bigint,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_kb_wallet_txn_user on public.kb_wallet_transactions(user_id, created_at desc);

-- =========================================================
-- 3) Billing events (auditable)
-- =========================================================
create table if not exists public.kb_billing_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  billing_account_id uuid references public.kb_billing_accounts(id) on delete set null,
  user_id uuid,
  organization_id uuid,
  event_type text not null,
  charged_by text, -- 'quota' | 'wallet' | 'already_consumed'
  amount_cents bigint not null default 0,
  currency text not null default 'TWD',
  reference_type text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, event_type)
);

create index if not exists idx_kb_billing_events_session on public.kb_billing_events(session_id, created_at desc);
alter table public.kb_billing_events enable row level security;
create policy "Platform admin view billing events" on public.kb_billing_events
  for select using (public.is_platform_admin());

-- =========================================================
-- 4) Payment provider configs (admin only; secrets server-side)
-- =========================================================
do $$ begin
  create type public.kb_payment_provider as enum ('manual','ecpay','newebpay','stripe','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kb_payment_provider_env as enum ('sandbox','production');
exception when duplicate_object then null; end $$;

create table if not exists public.kb_payment_provider_configs (
  id uuid primary key default gen_random_uuid(),
  provider public.kb_payment_provider not null,
  display_name text not null,
  environment public.kb_payment_provider_env not null default 'sandbox',
  is_enabled boolean not null default false,
  is_subscription_enabled boolean not null default false,
  is_wallet_topup_enabled boolean not null default false,
  merchant_id text,
  hash_key_encrypted text,
  hash_iv_encrypted text,
  api_base_url text,
  return_url text,
  notify_url text,
  client_back_url text,
  subscription_notify_url text,
  webhook_secret_encrypted text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_user_profiles(id) on delete set null,
  updated_by uuid references public.app_user_profiles(id) on delete set null,
  unique(provider, environment)
);

drop trigger if exists trg_kb_payment_provider_configs_updated_at on public.kb_payment_provider_configs;
create trigger trg_kb_payment_provider_configs_updated_at
before update on public.kb_payment_provider_configs
for each row execute function public.kb_touch_updated_at();

alter table public.kb_payment_provider_configs enable row level security;
create policy "Platform admin manage provider configs" on public.kb_payment_provider_configs
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- =========================================================
-- 5) Payment orders (wallet topup / subscription)
-- =========================================================
do $$ begin
  create type public.kb_payment_order_purpose as enum ('wallet_topup','subscription_initial','subscription_renewal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kb_payment_order_status as enum ('pending','paid','failed','canceled','expired','refunded');
exception when duplicate_object then null; end $$;

create table if not exists public.kb_payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid,
  provider public.kb_payment_provider not null default 'manual',
  provider_trade_no text,
  merchant_trade_no text not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'TWD',
  purpose public.kb_payment_order_purpose not null,
  status public.kb_payment_order_status not null default 'pending',
  paid_at timestamptz,
  raw_request jsonb,
  raw_callback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_kb_payment_orders_updated_at on public.kb_payment_orders;
create trigger trg_kb_payment_orders_updated_at
before update on public.kb_payment_orders
for each row execute function public.kb_touch_updated_at();

alter table public.kb_payment_orders enable row level security;
create policy "Platform admin view payment orders" on public.kb_payment_orders
  for select using (public.is_platform_admin());

-- =========================================================
-- 6) Subscription tables: extend existing kb_subscriptions + add invoices/events
-- =========================================================
alter table public.kb_subscriptions
  add column if not exists user_id uuid,
  add column if not exists organization_id uuid,
  add column if not exists provider public.kb_payment_provider,
  add column if not exists provider_subscription_id text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_payment_method_id text,
  add column if not exists next_billing_at timestamptz,
  add column if not exists trial_start timestamptz,
  add column if not exists trial_end timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists last_payment_order_id uuid references public.kb_payment_orders(id),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.kb_subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.kb_subscriptions(id) on delete cascade,
  user_id uuid not null,
  organization_id uuid,
  provider public.kb_payment_provider not null default 'manual',
  provider_invoice_id text,
  amount_cents bigint not null,
  currency text not null default 'TWD',
  period_start timestamptz,
  period_end timestamptz,
  status text not null check (status in ('pending','paid','failed','void','refunded')) default 'pending',
  paid_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  payment_order_id uuid references public.kb_payment_orders(id),
  raw_callback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_kb_subscription_invoices_updated_at on public.kb_subscription_invoices;
create trigger trg_kb_subscription_invoices_updated_at
before update on public.kb_subscription_invoices
for each row execute function public.kb_touch_updated_at();

create table if not exists public.kb_subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.kb_subscriptions(id) on delete set null,
  user_id uuid,
  provider public.kb_payment_provider not null default 'manual',
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.kb_subscription_invoices enable row level security;
alter table public.kb_subscription_events enable row level security;
create policy "Platform admin view subscription invoices" on public.kb_subscription_invoices
  for select using (public.is_platform_admin());
create policy "Platform admin view subscription events" on public.kb_subscription_events
  for select using (public.is_platform_admin());

-- =========================================================
-- 7) Plan seed update (500 / 10 quota / 80 per registration)
-- =========================================================
-- Keep existing rows but upsert new plan codes for UI & billing rules.
insert into public.kb_plans (plan_code, plan_name, plan_type, price_twd, is_active)
values
  ('free_wallet_only', '儲值金用戶', 'personal', 0, true),
  ('personal_monthly_500', '個人月費 500', 'personal', 500, true)
on conflict (plan_code) do update
set plan_name = excluded.plan_name,
    plan_type = excluded.plan_type,
    price_twd = excluded.price_twd,
    is_active = true;

-- Entitlements: map included quota + overage price (TWD 80)
insert into public.kb_plan_entitlements (
  plan_id,
  included_host_seats,
  monthly_quota_per_host,
  monthly_quota_personal,
  trial_session_count,
  overage_price_twd,
  roster_sharing_enabled,
  ratings_shared_enabled,
  add_on_seat_allowed
)
select
  p.id,
  1,
  0,
  case when p.plan_code = 'personal_monthly_500' then 10 else 0 end,
  0,
  80,
  false,
  true,
  false
from public.kb_plans p
where p.plan_code in ('free_wallet_only','personal_monthly_500')
on conflict (plan_id) do update
set monthly_quota_personal = excluded.monthly_quota_personal,
    trial_session_count = excluded.trial_session_count,
    overage_price_twd = excluded.overage_price_twd;

-- =========================================================
-- 8) Helper: wallet debit in cents (non-negative)
-- =========================================================
create or replace function public.kb_wallet_debit_cents(
  p_billing_account_id uuid,
  p_amount_cents bigint,
  p_user_id uuid,
  p_reason public.kb_wallet_txn_reason,
  p_reference_type text,
  p_reference_id uuid,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_wallet public.kb_wallets%rowtype;
  v_txn_id uuid;
  v_before bigint;
  v_after bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_wallet
  from public.kb_wallets
  where billing_account_id = p_billing_account_id
  for update;

  if not found then
    raise exception 'WALLET_NOT_FOUND';
  end if;

  v_before := coalesce(v_wallet.balance_cents, 0);
  v_after := v_before - p_amount_cents;

  if v_after < 0 then
    raise exception 'WALLET_INSUFFICIENT_BALANCE';
  end if;

  update public.kb_wallets
  set balance_cents = v_after,
      balance = (v_after::numeric / 100.0),
      updated_at = now()
  where id = v_wallet.id;

  insert into public.kb_wallet_transactions(
    wallet_id,
    txn_type,
    amount,
    balance_before,
    balance_after,
    reference_type,
    reference_id,
    note,
    user_id,
    organization_id,
    amount_cents,
    direction,
    reason,
    balance_after_cents,
    metadata
  )
  values (
    v_wallet.id,
    'debit_overage',
    (p_amount_cents::numeric / 100.0) * -1,
    (v_before::numeric / 100.0),
    (v_after::numeric / 100.0),
    p_reference_type,
    p_reference_id,
    p_note,
    p_user_id,
    null,
    p_amount_cents,
    'debit',
    p_reason,
    v_after,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- =========================================================
-- 9) RPC: open registration with billing (single entry)
-- =========================================================
create or replace function public.kb_open_registration_with_billing(p_session_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.sessions%rowtype;
  v_billing_account_id uuid;
  v_subscription record;
  v_bucket record;
  v_wallet_balance_cents bigint := 0;
  v_quota_remaining integer := 0;
  v_charged_by text;
  v_event_id uuid;
  v_txn_id uuid;
  v_ledger_id uuid;
  v_fee_cents bigint := 8000; -- NT$80
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  -- Permission: host or org member of session.billing_account_id (organization account)
  if v_session.host_user_id <> v_user_id then
    if v_session.billing_account_id is null then
      raise exception 'NO_PERMISSION';
    end if;
    -- allow org roles
    if not exists (
      select 1
      from public.kb_billing_accounts ba
      join public.kb_organizations o on o.id = ba.organization_id
      join public.kb_organization_members m on m.organization_id = o.id
      where ba.id = v_session.billing_account_id
        and ba.account_type = 'organization'
        and m.user_id = v_user_id
        and m.is_active = true
        and m.role in ('owner','host','manager')
    ) then
      raise exception 'NO_PERMISSION';
    end if;
  end if;

  -- Only allow open from draft-like states.
  if v_session.status not in ('draft','pending_confirmation') then
    -- idempotent: already open or later stage
    if v_session.status = 'registration_open' then
      return jsonb_build_object(
        'ok', true,
        'session_id', p_session_id,
        'billing_status', v_session.billing_status,
        'charged_by', 'already_open',
        'quota_remaining', null,
        'wallet_balance', null,
        'session_status', v_session.status
      );
    end if;
    raise exception 'INVALID_SESSION_STATUS';
  end if;

  -- Idempotency: already consumed for this session (from previous flow)
  if v_session.quota_ledger_id is not null or v_session.overage_charge_id is not null or v_session.billing_consumed_at is not null then
    update public.sessions
    set status = 'registration_open',
        allow_self_signup = true,
        registration_opened_at = coalesce(registration_opened_at, now()),
        updated_at = now()
    where id = p_session_id;

    return jsonb_build_object(
      'ok', true,
      'session_id', p_session_id,
      'billing_status', v_session.billing_status,
      'charged_by', 'already_consumed',
      'quota_remaining', null,
      'wallet_balance', null,
      'session_status', 'registration_open'
    );
  end if;

  v_billing_account_id := public.kb_resolve_billing_account_for_session(p_session_id);

  select balance_cents into v_wallet_balance_cents
  from public.kb_wallets
  where billing_account_id = v_billing_account_id;
  v_wallet_balance_cents := coalesce(v_wallet_balance_cents, 0);

  select * into v_subscription
  from public.kb_get_active_subscription(v_billing_account_id);

  select * into v_bucket
  from public.kb_find_consumable_bucket(v_billing_account_id, v_user_id, now())
  for update;

  if found then
    v_quota_remaining := v_bucket.quota_limit - v_bucket.quota_used;
  end if;

  if found and v_quota_remaining > 0 then
    -- Consume quota 1
    update public.kb_quota_buckets
    set quota_used = quota_used + 1
    where id = v_bucket.bucket_id;

    insert into public.kb_quota_ledger (
      bucket_id, billing_account_id, user_id, session_id, action, quantity, reference_type, reference_id, note
    ) values (
      v_bucket.bucket_id, v_billing_account_id, v_user_id, p_session_id, 'consume', 1,
      'session', p_session_id,
      'Consume 1 quota on registration open'
    )
    returning id into v_ledger_id;

    v_charged_by := 'quota';
  else
    -- Charge wallet NT$80
    v_txn_id := public.kb_wallet_debit_cents(
      p_billing_account_id => v_billing_account_id,
      p_amount_cents => v_fee_cents,
      p_user_id => v_user_id,
      p_reason => 'session_registration',
      p_reference_type => 'session',
      p_reference_id => p_session_id,
      p_note => 'Charge on registration open',
      p_metadata => jsonb_build_object('fee_cents', v_fee_cents)
    );

    v_charged_by := 'wallet';
    v_wallet_balance_cents := v_wallet_balance_cents - v_fee_cents;
  end if;

  insert into public.kb_billing_events(
    session_id,
    billing_account_id,
    user_id,
    organization_id,
    event_type,
    charged_by,
    amount_cents,
    currency,
    reference_type,
    reference_id,
    metadata
  )
  values (
    p_session_id,
    v_billing_account_id,
    v_user_id,
    null,
    'session_registration_opened',
    v_charged_by,
    case when v_charged_by = 'wallet' then v_fee_cents else 0 end,
    'TWD',
    'session',
    p_session_id,
    jsonb_build_object(
      'quota_bucket_id', case when v_charged_by = 'quota' then v_bucket.bucket_id else null end,
      'quota_ledger_id', v_ledger_id,
      'wallet_txn_id', v_txn_id
    )
  )
  returning id into v_event_id;

  update public.sessions
  set
    status = 'registration_open',
    allow_self_signup = true,
    billing_account_id = v_billing_account_id,
    billing_consumed_at = now(),
    billing_charged_by = v_charged_by,
    billing_event_id = v_event_id,
    quota_ledger_id = v_ledger_id,
    registration_opened_at = coalesce(registration_opened_at, now()),
    first_started_at = null,
    updated_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'billing_status', (select billing_status from public.sessions where id = p_session_id),
    'charged_by', v_charged_by,
    'quota_remaining', case when found then (v_bucket.quota_limit - (v_bucket.quota_used + case when v_charged_by='quota' then 1 else 0 end)) else 0 end,
    'wallet_balance', (v_wallet_balance_cents::numeric / 100.0),
    'session_status', 'registration_open'
  );
end;
$$;

grant execute on function public.kb_open_registration_with_billing(uuid) to authenticated, service_role;

commit;

