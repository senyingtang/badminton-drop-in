-- Badminton Headless Platform
-- Subscription / Billing / Quota / Trial / Overage SQL v1
-- PostgreSQL / Supabase oriented schema extension

create extension if not exists pgcrypto;

-- =========================================================
-- ENUMS
-- =========================================================

do $$ begin
    create type public.kb_billing_account_type as enum ('personal','organization');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_subscription_status as enum (
        'trialing','active','past_due','paused','cancelled','expired'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_plan_type as enum ('personal','organization');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_billing_charge_type as enum (
        'subscription_initial','subscription_renewal','overage','wallet_topup','manual_adjustment','refund'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_billing_charge_status as enum (
        'draft','pending','paid','failed','voided','refunded'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_quota_bucket_type as enum ('trial','monthly_host','monthly_personal','bonus','manual');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_quota_ledger_action as enum ('consume','reverse','grant','expire');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_wallet_txn_type as enum (
        'topup','debit_overage','credit_adjustment','debit_adjustment','refund'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_payment_method_status as enum ('pending','active','inactive','failed');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kb_session_billing_status as enum (
        'not_evaluated','trial_consumed','quota_consumed','overage_charged','blocked','not_billable'
    );
exception when duplicate_object then null; end $$;

-- =========================================================
-- ORGANIZATIONS / MEMBERS
-- =========================================================

create table if not exists public.kb_organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text unique,
    owner_user_id uuid not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.kb_organization_members (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.kb_organizations(id) on delete cascade,
    user_id uuid not null,
    role text not null check (role in ('owner','host','manager')),
    is_active boolean not null default true,
    joined_at timestamptz not null default now(),
    unique (organization_id, user_id)
);

create index if not exists idx_kb_org_members_org on public.kb_organization_members(organization_id);
create index if not exists idx_kb_org_members_user on public.kb_organization_members(user_id);

-- =========================================================
-- PLANS / ENTITLEMENTS
-- =========================================================

create table if not exists public.kb_plans (
    id uuid primary key default gen_random_uuid(),
    plan_code text not null unique,
    plan_name text not null,
    plan_type public.kb_plan_type not null,
    billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly')),
    price_twd numeric(12,2) not null check (price_twd >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.kb_plan_entitlements (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.kb_plans(id) on delete cascade,
    included_host_seats integer not null default 1 check (included_host_seats >= 1),
    monthly_quota_per_host integer not null default 0 check (monthly_quota_per_host >= 0),
    monthly_quota_personal integer not null default 0 check (monthly_quota_personal >= 0),
    trial_session_count integer not null default 0 check (trial_session_count >= 0),
    overage_price_twd numeric(12,2) not null default 50 check (overage_price_twd >= 0),
    roster_sharing_enabled boolean not null default false,
    ratings_shared_enabled boolean not null default true,
    add_on_seat_allowed boolean not null default false,
    created_at timestamptz not null default now(),
    unique(plan_id)
);

-- =========================================================
-- BILLING ACCOUNTS / SUBSCRIPTIONS
-- =========================================================

create table if not exists public.kb_billing_accounts (
    id uuid primary key default gen_random_uuid(),
    account_type public.kb_billing_account_type not null,
    owner_user_id uuid,
    organization_id uuid references public.kb_organizations(id) on delete cascade,
    display_name text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (
        (account_type = 'personal' and owner_user_id is not null and organization_id is null)
        or
        (account_type = 'organization' and owner_user_id is null and organization_id is not null)
    )
);

create unique index if not exists ux_kb_billing_account_personal
on public.kb_billing_accounts(owner_user_id)
where account_type = 'personal';

create unique index if not exists ux_kb_billing_account_org
on public.kb_billing_accounts(organization_id)
where account_type = 'organization';

create table if not exists public.kb_subscriptions (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid not null references public.kb_billing_accounts(id) on delete cascade,
    plan_id uuid not null references public.kb_plans(id),
    status public.kb_subscription_status not null,
    trial_started_at timestamptz,
    trial_ends_at timestamptz,
    current_period_start timestamptz,
    current_period_end timestamptz,
    auto_renew boolean not null default true,
    cancel_at_period_end boolean not null default false,
    payment_method_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_kb_subscriptions_account on public.kb_subscriptions(billing_account_id);
create index if not exists idx_kb_subscriptions_status on public.kb_subscriptions(status);

create table if not exists public.kb_subscription_periods (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references public.kb_subscriptions(id) on delete cascade,
    period_no integer not null check (period_no >= 1),
    period_start timestamptz not null,
    period_end timestamptz not null,
    status text not null default 'open' check (status in ('open','closed','expired')),
    created_at timestamptz not null default now(),
    unique(subscription_id, period_no)
);

-- =========================================================
-- PAYMENT METHODS / WALLETS
-- =========================================================

create table if not exists public.kb_payment_methods (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid not null references public.kb_billing_accounts(id) on delete cascade,
    provider_code text not null,
    provider_customer_ref text,
    provider_payment_method_ref text,
    status public.kb_payment_method_status not null default 'pending',
    is_default boolean not null default false,
    masked_label text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.kb_wallets (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid not null unique references public.kb_billing_accounts(id) on delete cascade,
    currency text not null default 'TWD',
    balance numeric(12,2) not null default 0,
    allow_negative boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.kb_wallet_transactions (
    id uuid primary key default gen_random_uuid(),
    wallet_id uuid not null references public.kb_wallets(id) on delete cascade,
    txn_type public.kb_wallet_txn_type not null,
    amount numeric(12,2) not null,
    balance_before numeric(12,2) not null,
    balance_after numeric(12,2) not null,
    reference_type text,
    reference_id uuid,
    note text,
    created_at timestamptz not null default now()
);

create index if not exists idx_kb_wallet_txn_wallet on public.kb_wallet_transactions(wallet_id, created_at desc);

-- =========================================================
-- QUOTA
-- =========================================================

create table if not exists public.kb_quota_buckets (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid not null references public.kb_billing_accounts(id) on delete cascade,
    subscription_id uuid references public.kb_subscriptions(id) on delete cascade,
    user_id uuid,
    bucket_type public.kb_quota_bucket_type not null,
    quota_limit integer not null check (quota_limit >= 0),
    quota_used integer not null default 0 check (quota_used >= 0),
    valid_from timestamptz not null,
    valid_to timestamptz not null,
    source_label text,
    created_at timestamptz not null default now(),
    check (quota_used <= quota_limit or bucket_type in ('bonus','manual'))
);

create index if not exists idx_kb_quota_buckets_lookup
on public.kb_quota_buckets(billing_account_id, user_id, valid_from, valid_to);

create table if not exists public.kb_quota_ledger (
    id uuid primary key default gen_random_uuid(),
    bucket_id uuid not null references public.kb_quota_buckets(id) on delete cascade,
    billing_account_id uuid not null references public.kb_billing_accounts(id) on delete cascade,
    user_id uuid,
    session_id uuid,
    action public.kb_quota_ledger_action not null,
    quantity integer not null check (quantity > 0),
    reference_type text,
    reference_id uuid,
    note text,
    created_at timestamptz not null default now(),
    unique(session_id, action)
);

create index if not exists idx_kb_quota_ledger_account on public.kb_quota_ledger(billing_account_id, created_at desc);

-- =========================================================
-- CHARGES / INVOICES
-- =========================================================

create table if not exists public.kb_billing_charges (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid not null references public.kb_billing_accounts(id) on delete cascade,
    subscription_id uuid references public.kb_subscriptions(id),
    charge_type public.kb_billing_charge_type not null,
    status public.kb_billing_charge_status not null default 'draft',
    amount_twd numeric(12,2) not null check (amount_twd >= 0),
    reference_type text,
    reference_id uuid,
    external_payment_ref text,
    note text,
    created_at timestamptz not null default now(),
    paid_at timestamptz
);

create index if not exists idx_kb_charges_account on public.kb_billing_charges(billing_account_id, created_at desc);

create table if not exists public.kb_billing_invoices (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid not null references public.kb_billing_accounts(id) on delete cascade,
    invoice_no text unique,
    status text not null default 'draft' check (status in ('draft','issued','paid','voided')),
    period_start timestamptz,
    period_end timestamptz,
    subtotal_twd numeric(12,2) not null default 0,
    total_twd numeric(12,2) not null default 0,
    issued_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.kb_billing_invoice_lines (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references public.kb_billing_invoices(id) on delete cascade,
    line_type text not null,
    description text not null,
    quantity integer not null default 1,
    unit_price_twd numeric(12,2) not null default 0,
    line_total_twd numeric(12,2) not null default 0,
    reference_type text,
    reference_id uuid
);

-- =========================================================
-- USAGE EVENTS / SETTINGS
-- =========================================================

create table if not exists public.kb_usage_events (
    id uuid primary key default gen_random_uuid(),
    billing_account_id uuid references public.kb_billing_accounts(id) on delete cascade,
    user_id uuid,
    session_id uuid,
    event_type text not null check (event_type in ('session_first_start','trial_consumed','quota_consumed','overage_charged')),
    occurred_at timestamptz not null default now(),
    unique(session_id, event_type)
);

create table if not exists public.kb_feature_flags (
    key text primary key,
    value_boolean boolean,
    value_text text,
    updated_at timestamptz not null default now()
);

create table if not exists public.kb_system_settings (
    key text primary key,
    value_text text,
    updated_at timestamptz not null default now()
);

-- =========================================================
-- SESSION EXTENSIONS
-- Assumes public.kb_sessions exists.
-- =========================================================

alter table public.kb_sessions
    add column if not exists billing_account_id uuid references public.kb_billing_accounts(id),
    add column if not exists billing_status public.kb_session_billing_status not null default 'not_evaluated',
    add column if not exists first_started_at timestamptz,
    add column if not exists quota_consumed_at timestamptz,
    add column if not exists quota_ledger_id uuid references public.kb_quota_ledger(id),
    add column if not exists overage_charge_id uuid references public.kb_billing_charges(id);

create index if not exists idx_kb_sessions_billing_account on public.kb_sessions(billing_account_id);

-- =========================================================
-- SEED-STYLE SAFETY HELPERS
-- =========================================================

create or replace function public.kb_get_setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
as $$
    select coalesce((select value_boolean from public.kb_feature_flags where key = p_key), p_default);
$$;

create or replace function public.kb_get_setting_text(p_key text, p_default text)
returns text
language sql
stable
as $$
    select coalesce((select value_text from public.kb_system_settings where key = p_key), p_default);
$$;

-- =========================================================
-- BILLING ACCOUNT RESOLUTION
-- =========================================================

create or replace function public.kb_is_org_host(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
    select exists(
        select 1
        from public.kb_organization_members m
        where m.organization_id = p_org_id
          and m.user_id = p_user_id
          and m.is_active = true
    );
$$;

create or replace function public.kb_resolve_billing_account_for_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
    v_session_host uuid;
    v_account_id uuid;
begin
    select host_user_id, billing_account_id
      into v_session_host, v_account_id
    from public.kb_sessions
    where id = p_session_id;

    if v_account_id is not null then
        return v_account_id;
    end if;

    select ba.id
      into v_account_id
    from public.kb_billing_accounts ba
    where ba.account_type = 'personal'
      and ba.owner_user_id = v_session_host
    limit 1;

    if v_account_id is null then
        raise exception 'No billing account found for session %', p_session_id;
    end if;

    update public.kb_sessions
    set billing_account_id = v_account_id
    where id = p_session_id;

    return v_account_id;
end;
$$;

-- =========================================================
-- QUOTA BUCKET RESOLUTION
-- =========================================================

create or replace function public.kb_get_active_subscription(p_billing_account_id uuid)
returns table (
    subscription_id uuid,
    plan_id uuid,
    subscription_status public.kb_subscription_status,
    current_period_start timestamptz,
    current_period_end timestamptz,
    auto_renew boolean
)
language sql
stable
as $$
    select s.id, s.plan_id, s.status, s.current_period_start, s.current_period_end, s.auto_renew
    from public.kb_subscriptions s
    where s.billing_account_id = p_billing_account_id
      and s.status in ('trialing','active','past_due')
    order by s.created_at desc
    limit 1;
$$;

create or replace function public.kb_find_consumable_bucket(
    p_billing_account_id uuid,
    p_user_id uuid,
    p_now timestamptz default now()
)
returns table (
    bucket_id uuid,
    bucket_type public.kb_quota_bucket_type,
    quota_limit integer,
    quota_used integer,
    valid_from timestamptz,
    valid_to timestamptz
)
language sql
stable
as $$
    select b.id, b.bucket_type, b.quota_limit, b.quota_used, b.valid_from, b.valid_to
    from public.kb_quota_buckets b
    where b.billing_account_id = p_billing_account_id
      and (b.user_id = p_user_id or b.user_id is null)
      and p_now between b.valid_from and b.valid_to
      and b.quota_used < b.quota_limit
    order by case b.bucket_type
        when 'trial' then 1
        when 'monthly_host' then 2
        when 'monthly_personal' then 3
        when 'bonus' then 4
        when 'manual' then 5
        else 99 end,
        b.valid_from asc
    limit 1;
$$;

-- =========================================================
-- WALLET DEBIT HELPER
-- =========================================================

create or replace function public.kb_wallet_debit(
    p_billing_account_id uuid,
    p_amount numeric,
    p_reference_type text,
    p_reference_id uuid,
    p_note text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
    v_wallet public.kb_wallets%rowtype;
    v_txn_id uuid;
begin
    select * into v_wallet
    from public.kb_wallets
    where billing_account_id = p_billing_account_id
    for update;

    if not found then
        raise exception 'Wallet not found for billing account %', p_billing_account_id;
    end if;

    if v_wallet.allow_negative = false and v_wallet.balance < p_amount then
        raise exception 'INSUFFICIENT_WALLET_BALANCE';
    end if;

    insert into public.kb_wallet_transactions (
        wallet_id, txn_type, amount, balance_before, balance_after, reference_type, reference_id, note
    ) values (
        v_wallet.id, 'debit_overage', p_amount * -1, v_wallet.balance, v_wallet.balance - p_amount,
        p_reference_type, p_reference_id, p_note
    ) returning id into v_txn_id;

    update public.kb_wallets
    set balance = balance - p_amount,
        updated_at = now()
    where id = v_wallet.id;

    return v_txn_id;
end;
$$;

-- =========================================================
-- PREFLIGHT RPC
-- =========================================================

create or replace function public.kb_billing_preflight_session_start(p_session_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_user_id uuid := auth.uid();
    v_session record;
    v_billing_account_id uuid;
    v_subscription record;
    v_bucket record;
    v_entitlement record;
    v_wallet_balance numeric := 0;
    v_overage_price numeric := 50;
    v_trial_remaining integer := 0;
    v_quota_remaining integer := 0;
    v_consume_mode text;
    v_will_block boolean := false;
    v_message text;
begin
    select s.* into v_session
    from public.kb_sessions s
    where s.id = p_session_id;

    if not found then
        raise exception 'SESSION_NOT_FOUND';
    end if;

    if v_session.host_user_id <> v_user_id then
        raise exception 'NO_PERMISSION';
    end if;

    if v_session.quota_ledger_id is not null or v_session.overage_charge_id is not null then
        return jsonb_build_object(
            'session_id', p_session_id,
            'can_start', true,
            'consume_mode', 'already_consumed',
            'billing_account_id', v_session.billing_account_id,
            'will_block', false,
            'message', 'Billing already handled for this session.'
        );
    end if;

    v_billing_account_id := public.kb_resolve_billing_account_for_session(p_session_id);

    select * into v_subscription
    from public.kb_get_active_subscription(v_billing_account_id);

    if found then
        select e.* into v_entitlement
        from public.kb_plan_entitlements e
        where e.plan_id = v_subscription.plan_id;

        v_overage_price := coalesce(v_entitlement.overage_price_twd, 50);
    end if;

    select balance into v_wallet_balance
    from public.kb_wallets
    where billing_account_id = v_billing_account_id;

    v_wallet_balance := coalesce(v_wallet_balance, 0);

    select * into v_bucket
    from public.kb_find_consumable_bucket(v_billing_account_id, v_user_id, now());

    if found then
        v_quota_remaining := v_bucket.quota_limit - v_bucket.quota_used;
        if v_bucket.bucket_type = 'trial' then
            v_trial_remaining := v_quota_remaining;
            v_consume_mode := 'trial';
            v_message := 'This session start will consume 1 trial session.';
        else
            v_consume_mode := 'monthly_quota';
            v_message := 'This session start will consume 1 monthly session quota.';
        end if;
    else
        v_consume_mode := 'overage';
        if public.kb_get_setting_bool('allow_negative_wallet_for_overage', false) = false and v_wallet_balance < v_overage_price then
            v_will_block := true;
            v_message := 'Quota exhausted and wallet balance is insufficient for overage.';
        else
            v_message := 'Quota exhausted. Starting this session will create a 50 TWD overage charge.';
        end if;
    end if;

    return jsonb_build_object(
        'session_id', p_session_id,
        'can_start', not v_will_block,
        'consume_mode', v_consume_mode,
        'billing_account_id', v_billing_account_id,
        'host_user_id', v_user_id,
        'plan_code', coalesce((select p.plan_code from public.kb_plans p where p.id = v_subscription.plan_id), null),
        'quota_limit', coalesce(v_bucket.quota_limit, 0),
        'quota_used', coalesce(v_bucket.quota_used, 0),
        'quota_remaining', v_quota_remaining,
        'trial_remaining', v_trial_remaining,
        'overage_price', v_overage_price,
        'wallet_balance', v_wallet_balance,
        'will_block', v_will_block,
        'message', v_message
    );
end;
$$;

-- =========================================================
-- CONSUME RPC
-- =========================================================

create or replace function public.kb_billing_consume_on_session_start(p_session_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_user_id uuid := auth.uid();
    v_session public.kb_sessions%rowtype;
    v_billing_account_id uuid;
    v_bucket record;
    v_ledger_id uuid;
    v_charge_id uuid;
    v_txn_id uuid;
    v_subscription record;
    v_entitlement record;
    v_overage_price numeric := 50;
begin
    select * into v_session
    from public.kb_sessions
    where id = p_session_id
    for update;

    if not found then
        raise exception 'SESSION_NOT_FOUND';
    end if;

    if v_session.host_user_id <> v_user_id then
        raise exception 'NO_PERMISSION';
    end if;

    if v_session.quota_ledger_id is not null or v_session.overage_charge_id is not null then
        return jsonb_build_object(
            'status', 'already_consumed',
            'session_id', p_session_id,
            'quota_ledger_id', v_session.quota_ledger_id,
            'overage_charge_id', v_session.overage_charge_id
        );
    end if;

    v_billing_account_id := public.kb_resolve_billing_account_for_session(p_session_id);

    select * into v_subscription
    from public.kb_get_active_subscription(v_billing_account_id);

    if found then
        select * into v_entitlement
        from public.kb_plan_entitlements
        where plan_id = v_subscription.plan_id;
        v_overage_price := coalesce(v_entitlement.overage_price_twd, 50);
    end if;

    select * into v_bucket
    from public.kb_find_consumable_bucket(v_billing_account_id, v_user_id, now())
    for update;

    if found then
        update public.kb_quota_buckets
        set quota_used = quota_used + 1
        where id = v_bucket.bucket_id;

        insert into public.kb_quota_ledger (
            bucket_id, billing_account_id, user_id, session_id, action, quantity, reference_type, reference_id, note
        ) values (
            v_bucket.bucket_id, v_billing_account_id, v_user_id, p_session_id, 'consume', 1,
            'session', p_session_id,
            case when v_bucket.bucket_type = 'trial' then 'Consume trial for first session start'
                 else 'Consume monthly quota for first session start' end
        ) returning id into v_ledger_id;

        insert into public.kb_usage_events (billing_account_id, user_id, session_id, event_type)
        values (
            v_billing_account_id,
            v_user_id,
            p_session_id,
            case when v_bucket.bucket_type = 'trial' then 'trial_consumed' else 'quota_consumed' end
        )
        on conflict do nothing;

        update public.kb_sessions
        set billing_account_id = v_billing_account_id,
            billing_status = case when v_bucket.bucket_type = 'trial' then 'trial_consumed' else 'quota_consumed' end,
            first_started_at = coalesce(first_started_at, now()),
            quota_consumed_at = now(),
            quota_ledger_id = v_ledger_id
        where id = p_session_id;

        return jsonb_build_object(
            'status', 'ok',
            'consume_mode', case when v_bucket.bucket_type = 'trial' then 'trial' else 'monthly_quota' end,
            'session_id', p_session_id,
            'quota_ledger_id', v_ledger_id
        );
    end if;

    insert into public.kb_billing_charges (
        billing_account_id, subscription_id, charge_type, status, amount_twd, reference_type, reference_id, note
    ) values (
        v_billing_account_id,
        v_subscription.subscription_id,
        'overage',
        'pending',
        v_overage_price,
        'session',
        p_session_id,
        'Overage charge for first session start after quota exhaustion'
    ) returning id into v_charge_id;

    begin
        v_txn_id := public.kb_wallet_debit(v_billing_account_id, v_overage_price, 'overage_charge', v_charge_id, 'Auto debit overage');
        update public.kb_billing_charges
        set status = 'paid', paid_at = now()
        where id = v_charge_id;
    exception when others then
        if public.kb_get_setting_bool('allow_negative_wallet_for_overage', false) = false then
            delete from public.kb_billing_charges where id = v_charge_id;
            raise exception 'OVERAGE_BLOCKED_INSUFFICIENT_WALLET';
        end if;
    end;

    insert into public.kb_usage_events (billing_account_id, user_id, session_id, event_type)
    values (v_billing_account_id, v_user_id, p_session_id, 'overage_charged')
    on conflict do nothing;

    update public.kb_sessions
    set billing_account_id = v_billing_account_id,
        billing_status = 'overage_charged',
        first_started_at = coalesce(first_started_at, now()),
        overage_charge_id = v_charge_id
    where id = p_session_id;

    return jsonb_build_object(
        'status', 'ok',
        'consume_mode', 'overage',
        'session_id', p_session_id,
        'overage_charge_id', v_charge_id
    );
end;
$$;

-- =========================================================
-- DASHBOARD VIEW / RPC
-- =========================================================

create or replace view public.kb_v_quota_dashboard_personal as
select
    ba.id as billing_account_id,
    ba.owner_user_id as user_id,
    p.plan_code,
    s.status as subscription_status,
    s.current_period_start,
    s.current_period_end,
    qb.quota_limit,
    qb.quota_used,
    greatest(qb.quota_limit - qb.quota_used, 0) as quota_remaining,
    w.balance as wallet_balance
from public.kb_billing_accounts ba
join public.kb_subscriptions s on s.billing_account_id = ba.id
join public.kb_plans p on p.id = s.plan_id
left join public.kb_quota_buckets qb
    on qb.billing_account_id = ba.id
   and qb.user_id = ba.owner_user_id
   and now() between qb.valid_from and qb.valid_to
left join public.kb_wallets w on w.billing_account_id = ba.id
where ba.account_type = 'personal';

create or replace function public.kb_get_quota_dashboard(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
as $$
declare
    v_personal_account uuid;
    v_org record;
    v_result jsonb;
begin
    select id into v_personal_account
    from public.kb_billing_accounts
    where account_type = 'personal'
      and owner_user_id = p_user_id
    limit 1;

    if v_personal_account is not null then
        return (
            select jsonb_build_object(
                'billing_account_type', 'personal',
                'billing_account_id', billing_account_id,
                'user_id', user_id,
                'plan_code', plan_code,
                'subscription_status', subscription_status,
                'period_start', current_period_start,
                'period_end', current_period_end,
                'quota_limit', quota_limit,
                'quota_used', quota_used,
                'quota_remaining', quota_remaining,
                'wallet_balance', coalesce(wallet_balance,0)
            )
            from public.kb_v_quota_dashboard_personal
            where billing_account_id = v_personal_account
            limit 1
        );
    end if;

    select o.id, o.name, ba.id as billing_account_id
      into v_org
    from public.kb_organization_members m
    join public.kb_organizations o on o.id = m.organization_id
    join public.kb_billing_accounts ba on ba.organization_id = o.id and ba.account_type = 'organization'
    where m.user_id = p_user_id and m.is_active = true
    order by case when m.role = 'owner' then 0 else 1 end
    limit 1;

    if v_org.billing_account_id is null then
        raise exception 'NO_BILLING_ACCOUNT_CONTEXT';
    end if;

    return (
        select jsonb_build_object(
            'billing_account_type', 'organization',
            'billing_account_id', v_org.billing_account_id,
            'organization', jsonb_build_object('id', v_org.id, 'name', v_org.name),
            'subscription', (
                select jsonb_build_object(
                    'plan_code', p.plan_code,
                    'status', s.status,
                    'period_start', s.current_period_start,
                    'period_end', s.current_period_end
                )
                from public.kb_subscriptions s
                join public.kb_plans p on p.id = s.plan_id
                where s.billing_account_id = v_org.billing_account_id
                order by s.created_at desc
                limit 1
            ),
            'wallet_balance', coalesce((select balance from public.kb_wallets where billing_account_id = v_org.billing_account_id),0),
            'hosts', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'user_id', m.user_id,
                    'role', m.role,
                    'quota_limit', coalesce(qb.quota_limit,0),
                    'quota_used', coalesce(qb.quota_used,0),
                    'quota_remaining', greatest(coalesce(qb.quota_limit,0) - coalesce(qb.quota_used,0),0)
                ) order by m.joined_at asc)
                from public.kb_organization_members m
                left join public.kb_quota_buckets qb
                    on qb.billing_account_id = v_org.billing_account_id
                   and qb.user_id = m.user_id
                   and now() between qb.valid_from and qb.valid_to
                where m.organization_id = v_org.id
                  and m.is_active = true
            ), '[]'::jsonb)
        )
    );
end;
$$;

-- =========================================================
-- SUBSCRIPTION ACTIVATION / RENEWAL HELPERS
-- =========================================================

create or replace function public.kb_create_personal_billing_account_if_missing(p_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
    v_id uuid;
begin
    select id into v_id
    from public.kb_billing_accounts
    where account_type = 'personal' and owner_user_id = p_user_id
    limit 1;

    if v_id is null then
        insert into public.kb_billing_accounts(account_type, owner_user_id, display_name)
        values ('personal', p_user_id, 'Personal Account')
        returning id into v_id;

        insert into public.kb_wallets(billing_account_id, balance)
        values (v_id, 0);
    end if;

    return v_id;
end;
$$;

create or replace function public.kb_subscription_activate(
    p_billing_account_id uuid,
    p_plan_code text,
    p_period_start timestamptz default now(),
    p_auto_renew boolean default true
)
returns uuid
language plpgsql
security definer
as $$
declare
    v_plan_id uuid;
    v_sub_id uuid;
    v_ent record;
    v_account record;
    v_member record;
    v_period_end timestamptz;
begin
    select * into v_account
    from public.kb_billing_accounts
    where id = p_billing_account_id;

    if not found then
        raise exception 'BILLING_ACCOUNT_NOT_FOUND';
    end if;

    select id into v_plan_id
    from public.kb_plans
    where plan_code = p_plan_code and is_active = true;

    if v_plan_id is null then
        raise exception 'PLAN_NOT_FOUND';
    end if;

    select * into v_ent from public.kb_plan_entitlements where plan_id = v_plan_id;

    v_period_end := (p_period_start + interval '1 month') - interval '1 second';

    insert into public.kb_subscriptions (
        billing_account_id, plan_id, status, current_period_start, current_period_end, auto_renew
    ) values (
        p_billing_account_id, v_plan_id, 'active', p_period_start, v_period_end, p_auto_renew
    ) returning id into v_sub_id;

    insert into public.kb_subscription_periods(subscription_id, period_no, period_start, period_end, status)
    values (v_sub_id, 1, p_period_start, v_period_end, 'open');

    if v_account.account_type = 'personal' then
        insert into public.kb_quota_buckets (
            billing_account_id, subscription_id, user_id, bucket_type, quota_limit, quota_used, valid_from, valid_to, source_label
        ) values (
            p_billing_account_id, v_sub_id, v_account.owner_user_id, 'monthly_personal',
            v_ent.monthly_quota_personal, 0, p_period_start, v_period_end, 'initial_personal_period'
        );
    else
        for v_member in
            select user_id, role
            from public.kb_organization_members
            where organization_id = v_account.organization_id
              and is_active = true
              and role in ('owner','host','manager')
        loop
            insert into public.kb_quota_buckets (
                billing_account_id, subscription_id, user_id, bucket_type, quota_limit, quota_used, valid_from, valid_to, source_label
            ) values (
                p_billing_account_id, v_sub_id, v_member.user_id, 'monthly_host',
                v_ent.monthly_quota_per_host, 0, p_period_start, v_period_end, 'initial_org_period'
            );
        end loop;
    end if;

    return v_sub_id;
end;
$$;

create or replace function public.kb_subscription_renew(p_subscription_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
    v_sub record;
    v_ent record;
    v_plan record;
    v_next_start timestamptz;
    v_next_end timestamptz;
    v_new_period_no integer;
    v_member record;
    v_charge_id uuid;
    v_wallet_txn uuid;
    v_account record;
begin
    select s.*, ba.account_type, ba.owner_user_id, ba.organization_id
      into v_sub
    from public.kb_subscriptions s
    join public.kb_billing_accounts ba on ba.id = s.billing_account_id
    where s.id = p_subscription_id
    for update;

    if not found then
        raise exception 'SUBSCRIPTION_NOT_FOUND';
    end if;

    if v_sub.auto_renew = false then
        raise exception 'AUTO_RENEW_DISABLED';
    end if;

    select p.*, e.*
      into v_plan
    from public.kb_plans p
    join public.kb_plan_entitlements e on e.plan_id = p.id
    where p.id = v_sub.plan_id;

    v_next_start := v_sub.current_period_end + interval '1 second';
    v_next_end := (v_next_start + interval '1 month') - interval '1 second';
    v_new_period_no := coalesce((select max(period_no) from public.kb_subscription_periods where subscription_id = p_subscription_id),0) + 1;

    insert into public.kb_billing_charges (
        billing_account_id, subscription_id, charge_type, status, amount_twd, note
    ) values (
        v_sub.billing_account_id, p_subscription_id, 'subscription_renewal', 'pending', v_plan.price_twd,
        'Monthly renewal'
    ) returning id into v_charge_id;

    begin
        v_wallet_txn := public.kb_wallet_debit(v_sub.billing_account_id, v_plan.price_twd, 'subscription_renewal', v_charge_id, 'Auto renewal debit');
        update public.kb_billing_charges
        set status = 'paid', paid_at = now()
        where id = v_charge_id;
    exception when others then
        update public.kb_subscriptions
        set status = 'past_due', updated_at = now()
        where id = p_subscription_id;
        raise exception 'RENEWAL_PAYMENT_FAILED';
    end;

    update public.kb_subscriptions
    set status = 'active',
        current_period_start = v_next_start,
        current_period_end = v_next_end,
        updated_at = now()
    where id = p_subscription_id;

    insert into public.kb_subscription_periods(subscription_id, period_no, period_start, period_end, status)
    values (p_subscription_id, v_new_period_no, v_next_start, v_next_end, 'open');

    if v_sub.account_type = 'personal' then
        insert into public.kb_quota_buckets (
            billing_account_id, subscription_id, user_id, bucket_type, quota_limit, quota_used, valid_from, valid_to, source_label
        ) values (
            v_sub.billing_account_id, p_subscription_id, v_sub.owner_user_id, 'monthly_personal',
            v_plan.monthly_quota_personal, 0, v_next_start, v_next_end, 'renewal_personal_period'
        );
    else
        for v_member in
            select user_id
            from public.kb_organization_members
            where organization_id = v_sub.organization_id
              and is_active = true
              and role in ('owner','host','manager')
        loop
            insert into public.kb_quota_buckets (
                billing_account_id, subscription_id, user_id, bucket_type, quota_limit, quota_used, valid_from, valid_to, source_label
            ) values (
                v_sub.billing_account_id, p_subscription_id, v_member.user_id, 'monthly_host',
                v_plan.monthly_quota_per_host, 0, v_next_start, v_next_end, 'renewal_org_period'
            );
        end loop;
    end if;

    return v_charge_id;
end;
$$;

-- =========================================================
-- SEAT / MEMBER HELPERS
-- =========================================================

create or replace function public.kb_org_invite_host(
    p_organization_id uuid,
    p_user_id uuid,
    p_role text default 'host'
)
returns uuid
language plpgsql
security definer
as $$
declare
    v_actor uuid := auth.uid();
    v_count integer;
    v_billing_account_id uuid;
    v_active_sub record;
    v_ent record;
    v_row_id uuid;
begin
    if not exists (
        select 1 from public.kb_organization_members
        where organization_id = p_organization_id
          and user_id = v_actor
          and role = 'owner'
          and is_active = true
    ) then
        raise exception 'NO_PERMISSION';
    end if;

    select count(*) into v_count
    from public.kb_organization_members
    where organization_id = p_organization_id
      and is_active = true
      and role in ('owner','host','manager');

    select ba.id into v_billing_account_id
    from public.kb_billing_accounts ba
    where ba.organization_id = p_organization_id
      and ba.account_type = 'organization';

    select * into v_active_sub
    from public.kb_get_active_subscription(v_billing_account_id);

    if not found then
        raise exception 'ACTIVE_SUBSCRIPTION_REQUIRED';
    end if;

    select e.* into v_ent
    from public.kb_plan_entitlements e
    where e.plan_id = v_active_sub.plan_id;

    if v_count >= v_ent.included_host_seats then
        raise exception 'SEAT_LIMIT_REACHED';
    end if;

    insert into public.kb_organization_members(organization_id, user_id, role, is_active)
    values (p_organization_id, p_user_id, p_role, true)
    on conflict (organization_id, user_id)
    do update set role = excluded.role, is_active = true
    returning id into v_row_id;

    insert into public.kb_quota_buckets (
        billing_account_id, subscription_id, user_id, bucket_type, quota_limit, quota_used, valid_from, valid_to, source_label
    )
    select v_billing_account_id, v_active_sub.subscription_id, p_user_id, 'monthly_host', e.monthly_quota_per_host, 0,
           v_active_sub.current_period_start, v_active_sub.current_period_end, 'mid_period_host_invite'
    from public.kb_plan_entitlements e
    where e.plan_id = v_active_sub.plan_id
      and not exists (
          select 1 from public.kb_quota_buckets qb
          where qb.billing_account_id = v_billing_account_id
            and qb.user_id = p_user_id
            and now() between qb.valid_from and qb.valid_to
      );

    return v_row_id;
end;
$$;

-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================

create or replace function public.kb_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_kb_organizations_updated_at on public.kb_organizations;
create trigger trg_kb_organizations_updated_at
before update on public.kb_organizations
for each row execute function public.kb_touch_updated_at();

drop trigger if exists trg_kb_billing_accounts_updated_at on public.kb_billing_accounts;
create trigger trg_kb_billing_accounts_updated_at
before update on public.kb_billing_accounts
for each row execute function public.kb_touch_updated_at();

drop trigger if exists trg_kb_subscriptions_updated_at on public.kb_subscriptions;
create trigger trg_kb_subscriptions_updated_at
before update on public.kb_subscriptions
for each row execute function public.kb_touch_updated_at();

drop trigger if exists trg_kb_payment_methods_updated_at on public.kb_payment_methods;
create trigger trg_kb_payment_methods_updated_at
before update on public.kb_payment_methods
for each row execute function public.kb_touch_updated_at();

drop trigger if exists trg_kb_wallets_updated_at on public.kb_wallets;
create trigger trg_kb_wallets_updated_at
before update on public.kb_wallets
for each row execute function public.kb_touch_updated_at();

-- =========================================================
-- PLAN SEEDS
-- =========================================================

insert into public.kb_plans (plan_code, plan_name, plan_type, price_twd)
values
('personal_monthly_350', 'Personal Monthly 350', 'personal', 350),
('org_5_hosts_1500', 'Organization 5 Hosts 1500', 'organization', 1500)
on conflict (plan_code) do update
set plan_name = excluded.plan_name,
    plan_type = excluded.plan_type,
    price_twd = excluded.price_twd,
    is_active = true;

insert into public.kb_plan_entitlements (
    plan_id, included_host_seats, monthly_quota_per_host, monthly_quota_personal,
    trial_session_count, overage_price_twd, roster_sharing_enabled, ratings_shared_enabled, add_on_seat_allowed
)
select p.id,
       case when p.plan_code = 'org_5_hosts_1500' then 5 else 1 end,
       case when p.plan_code = 'org_5_hosts_1500' then 10 else 0 end,
       case when p.plan_code = 'personal_monthly_350' then 8 else 0 end,
       case when p.plan_code = 'personal_monthly_350' then 3 else 5 end,
       50,
       false,
       true,
       false
from public.kb_plans p
on conflict (plan_id) do update
set included_host_seats = excluded.included_host_seats,
    monthly_quota_per_host = excluded.monthly_quota_per_host,
    monthly_quota_personal = excluded.monthly_quota_personal,
    trial_session_count = excluded.trial_session_count,
    overage_price_twd = excluded.overage_price_twd,
    roster_sharing_enabled = excluded.roster_sharing_enabled,
    ratings_shared_enabled = excluded.ratings_shared_enabled,
    add_on_seat_allowed = excluded.add_on_seat_allowed;

insert into public.kb_feature_flags(key, value_boolean)
values ('allow_negative_wallet_for_overage', false)
on conflict (key) do update set value_boolean = excluded.value_boolean, updated_at = now();

