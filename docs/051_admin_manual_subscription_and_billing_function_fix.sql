-- 051_admin_manual_subscription_and_billing_function_fix.sql
-- 1) Fix kb_open_registration_with_billing: do NOT hardcode 8000; read pricing from plan/entitlements only.
-- 2) Add admin audit logs table (if missing).
-- 3) Ensure subscription/quota tables have compatible columns for manual admin grants.
-- Safe to re-run.

begin;

-- =========================================================
-- A) Admin audit logs (if missing)
-- =========================================================
create table if not exists public.kb_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  target_user_id uuid references public.app_user_profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  note text,
  created_at timestamptz not null default now()
);

alter table public.kb_admin_audit_logs enable row level security;
drop policy if exists "Platform admin view admin audit logs" on public.kb_admin_audit_logs;
create policy "Platform admin view admin audit logs" on public.kb_admin_audit_logs
  for select using (public.is_platform_admin());

-- =========================================================
-- B) Ensure kb_plan_entitlements has updated_at + cents columns (compat with 049/050)
-- =========================================================
do $$
begin
  if to_regclass('public.kb_plan_entitlements') is not null then
    alter table public.kb_plan_entitlements
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists included_session_quota integer,
      add column if not exists overage_price_cents bigint;
  end if;
end $$;

-- =========================================================
-- C) Ensure kb_plans has cents + description columns (compat)
-- =========================================================
alter table public.kb_plans
  add column if not exists monthly_price_cents bigint,
  add column if not exists description text;

-- =========================================================
-- D) Ensure kb_subscriptions has manual provider columns (compat with 048)
-- =========================================================
alter table public.kb_subscriptions
  add column if not exists provider public.kb_payment_provider,
  add column if not exists canceled_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- =========================================================
-- E) Quota buckets: add admin-friendly columns (keep legacy columns working)
-- =========================================================
alter table public.kb_quota_buckets
  add column if not exists source text,
  add column if not exists status text,
  add column if not exists quota_total integer,
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz;

-- Backfill (non-destructive)
update public.kb_quota_buckets
set quota_total = coalesce(quota_total, quota_limit),
    period_start = coalesce(period_start, valid_from),
    period_end = coalesce(period_end, valid_to),
    source = coalesce(source, source_label),
    status = coalesce(status, 'active')
where quota_total is null
   or period_start is null
   or period_end is null
   or source is null
   or status is null;

-- =========================================================
-- F) Fix kb_open_registration_with_billing (no hardcoded 8000)
-- =========================================================
-- Requires: 048 already created kb_wallet_debit_cents, kb_billing_events, sessions fields, etc.
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
  v_ent record;
  v_bucket record;
  v_wallet_balance_cents bigint := 0;
  v_quota_remaining integer := 0;
  v_charged_by text;
  v_event_id uuid;
  v_txn_id uuid;
  v_ledger_id uuid;
  v_fee_cents bigint := null;
  v_fee_twd numeric := null;
  v_plan_code text := null;
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

  if v_session.status not in ('draft','pending_confirmation') then
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

  -- Idempotency
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

  if found then
    select p.plan_code, e.*
    into v_plan_code, v_ent
    from public.kb_plans p
    join public.kb_plan_entitlements e on e.plan_id = p.id
    where p.id = v_subscription.plan_id
    limit 1;
  else
    select p.plan_code, e.*
    into v_plan_code, v_ent
    from public.kb_plans p
    join public.kb_plan_entitlements e on e.plan_id = p.id
    where p.plan_code = 'free_wallet_only'
    limit 1;
  end if;

  -- Pricing must come from DB (no hardcoded constants)
  if v_ent.plan_id is null then
    raise exception 'PRICING_NOT_CONFIGURED';
  end if;
  if v_ent.overage_price_cents is not null then
    v_fee_cents := v_ent.overage_price_cents;
  else
    if v_ent.overage_price_twd is null then
      raise exception 'PRICING_NOT_CONFIGURED';
    end if;
    v_fee_cents := round(v_ent.overage_price_twd * 100)::bigint;
  end if;
  v_fee_twd := (v_fee_cents::numeric / 100.0);

  select * into v_bucket
  from public.kb_find_consumable_bucket(v_billing_account_id, v_user_id, now())
  for update;

  if found then
    v_quota_remaining := v_bucket.quota_limit - v_bucket.quota_used;
  end if;

  if found and v_quota_remaining > 0 then
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
    v_txn_id := public.kb_wallet_debit_cents(
      p_billing_account_id => v_billing_account_id,
      p_amount_cents => v_fee_cents,
      p_user_id => v_user_id,
      p_reason => 'session_registration',
      p_reference_type => 'session',
      p_reference_id => p_session_id,
      p_note => 'Charge on registration open',
      p_metadata => jsonb_build_object(
        'plan_code', v_plan_code,
        'fee_cents', v_fee_cents,
        'fee_twd', v_fee_twd
      )
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
      'plan_code', v_plan_code,
      'quota_bucket_id', case when v_charged_by = 'quota' then v_bucket.bucket_id else null end,
      'quota_ledger_id', v_ledger_id,
      'wallet_txn_id', v_txn_id,
      'fee_cents', v_fee_cents,
      'fee_twd', v_fee_twd
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
    updated_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'billing_status', (select billing_status from public.sessions where id = p_session_id),
    'charged_by', v_charged_by,
    'quota_remaining', case when found then (v_bucket.quota_limit - (v_bucket.quota_used + case when v_charged_by='quota' then 1 else 0 end)) else 0 end,
    'wallet_balance', (v_wallet_balance_cents::numeric / 100.0),
    'session_status', 'registration_open',
    'fee_cents', v_fee_cents,
    'fee_twd', v_fee_twd,
    'plan_code', v_plan_code
  );
end;
$$;

grant execute on function public.kb_open_registration_with_billing(uuid) to authenticated, service_role;

commit;

