
-- 003_seed_plans_and_defaults.sql

begin;

insert into public.billing_plans (
  code,
  name,
  scope,
  billing_interval,
  price_amount,
  currency,
  trial_session_count,
  included_session_count,
  auto_renew_default,
  is_active,
  metadata
)
values
(
  'HOST_PAY_PER_USE',
  'Host 單次計費方案',
  'host',
  'one_time',
  50,
  'TWD',
  3,
  null,
  false,
  true,
  jsonb_build_object(
    'charge_trigger', 'first_round_lock',
    'wallet_required', true,
    'description', '個人團主按下開打後，該 session 首次鎖定時扣款'
  )
),
(
  'VENUE_MONTHLY',
  'Venue 月費方案',
  'venue_owner',
  'monthly',
  500,
  'TWD',
  1,
  null,
  true,
  true,
  jsonb_build_object(
    'unlimited_hosts', true,
    'recommended_limit_hosts', null,
    'description', '場主月費方案，旗下團主可無限次使用'
  )
),
(
  'PLATFORM_INTERNAL',
  'Platform 內部方案',
  'platform',
  'monthly',
  0,
  'TWD',
  0,
  null,
  false,
  true,
  jsonb_build_object(
    'internal_only', true
  )
)
on conflict (code) do update
set
  name = excluded.name,
  scope = excluded.scope,
  billing_interval = excluded.billing_interval,
  price_amount = excluded.price_amount,
  currency = excluded.currency,
  trial_session_count = excluded.trial_session_count,
  included_session_count = excluded.included_session_count,
  auto_renew_default = excluded.auto_renew_default,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  updated_at = now();

commit;
