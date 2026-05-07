-- 049_update_monthly_overage_to_50.sql
-- Update pricing rules:
-- - free_wallet_only: overage NT$80 per registration
-- - personal_monthly_500: monthly NT$500, quota 10, overage NT$50 per registration when quota exhausted
-- - organization plans: overage NT$50 (if applicable)
-- Also: make kb_open_registration_with_billing read overage price from plan entitlements (no hardcoded 8000).

begin;

-- =========================================================
-- 1) Add cents-based columns (non-breaking)
-- =========================================================
alter table public.kb_plans
  add column if not exists monthly_price_cents bigint,
  add column if not exists description text;

alter table public.kb_plan_entitlements
  add column if not exists included_session_quota integer,
  add column if not exists overage_price_cents bigint;

-- Backfill from existing TWD numeric columns when missing
update public.kb_plans
set monthly_price_cents = coalesce(monthly_price_cents, round(coalesce(price_twd, 0) * 100)::bigint)
where monthly_price_cents is null;

update public.kb_plan_entitlements
set overage_price_cents = coalesce(overage_price_cents, round(coalesce(overage_price_twd, 0) * 100)::bigint)
where overage_price_cents is null;

-- Also map included_session_quota for personal plans (if missing)
update public.kb_plan_entitlements
set included_session_quota = coalesce(included_session_quota, monthly_quota_personal)
where included_session_quota is null;

-- =========================================================
-- 2) Seed / upsert plans with new pricing
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

-- Ensure entitlements for the two personal plans
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

-- If there are organization plans, set overage to NT$50 (5000 cents)
update public.kb_plan_entitlements e
set overage_price_twd = 50,
    overage_price_cents = 5000
from public.kb_plans p
where e.plan_id = p.id
  and p.plan_type = 'organization'
  and coalesce(e.overage_price_cents, 0) <> 5000;

-- =========================================================
-- 3) Replace kb_open_registration_with_billing to use plan overage_price_cents
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
  v_ent record;
  v_bucket record;
  v_wallet_balance_cents bigint := 0;
  v_quota_remaining integer := 0;
  v_charged_by text;
  v_event_id uuid;
  v_txn_id uuid;
  v_ledger_id uuid;
  v_fee_cents bigint := 0;
  v_fee_twd numeric := 0;
  v_fee_hint text := null;
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

  -- Only allow open from draft-like states.
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

  if found then
    select * into v_ent
    from public.kb_plan_entitlements
    where plan_id = v_subscription.plan_id;

    v_fee_cents := coalesce(v_ent.overage_price_cents, round(coalesce(v_ent.overage_price_twd, 0) * 100)::bigint, 5000);
    v_fee_hint := 'monthly_overage';
  else
    -- No subscription: use free_wallet_only as pricing source (overage = 8000 cents)
    select e.* into v_ent
    from public.kb_plans p
    join public.kb_plan_entitlements e on e.plan_id = p.id
    where p.plan_code = 'free_wallet_only'
    limit 1;

    v_fee_cents := coalesce(v_ent.overage_price_cents, round(coalesce(v_ent.overage_price_twd, 80) * 100)::bigint, 8000);
    v_fee_hint := 'free_wallet_only';
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
    -- Charge wallet by plan-defined overage price (cents)
    v_txn_id := public.kb_wallet_debit_cents(
      p_billing_account_id => v_billing_account_id,
      p_amount_cents => v_fee_cents,
      p_user_id => v_user_id,
      p_reason => 'session_registration',
      p_reference_type => 'session',
      p_reference_id => p_session_id,
      p_note => 'Charge on registration open',
      p_metadata => jsonb_build_object('fee_cents', v_fee_cents, 'fee_twd', v_fee_twd, 'fee_hint', v_fee_hint)
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
      'wallet_txn_id', v_txn_id,
      'fee_cents', v_fee_cents,
      'fee_twd', v_fee_twd,
      'fee_hint', v_fee_hint
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
    'fee_twd', v_fee_twd
  );
end;
$$;

grant execute on function public.kb_open_registration_with_billing(uuid) to authenticated, service_role;

commit;

