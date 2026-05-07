-- debug_diagnostic_queries.sql
-- Run these in Supabase SQL Editor to verify today's two production bugs.

-- 1) Compare legacy wallet vs new billing wallet for a host email.
-- Replace the email value.
with target as (
  select id, email
  from auth.users
  where lower(email) = lower('YOUR_HOST_EMAIL@example.com')
  limit 1
)
select
  t.email,
  t.id as auth_user_id,
  wa.balance_amount as legacy_wallet_accounts_balance,
  ba.id as kb_billing_account_id,
  kw.balance as kb_wallets_balance,
  kw.allow_negative,
  q.quota_limit,
  q.quota_used,
  greatest(coalesce(q.quota_limit,0) - coalesce(q.quota_used,0),0) as quota_remaining
from target t
left join public.wallet_accounts wa on wa.owner_user_id = t.id
left join public.kb_billing_accounts ba on ba.owner_user_id = t.id and ba.account_type = 'personal'
left join public.kb_wallets kw on kw.billing_account_id = ba.id
left join lateral (
  select quota_limit, quota_used
  from public.kb_quota_buckets qb
  where qb.billing_account_id = ba.id
    and (qb.user_id = t.id or qb.user_id is null)
    and now() between qb.valid_from and qb.valid_to
  order by qb.valid_from desc
  limit 1
) q on true;

-- 2) Check a session billing state before locking.
-- Replace SESSION_ID.
select
  s.id,
  s.title,
  s.status,
  s.host_user_id,
  s.has_first_charge_applied,
  s.billing_account_id,
  s.billing_status,
  s.quota_ledger_id,
  s.overage_charge_id,
  s.first_started_at
from public.sessions s
where s.id = 'SESSION_ID'::uuid;

-- 3) Check if lock_round_and_increment_counters still contains the legacy charge call.
select
  case
    when pg_get_functiondef('public.lock_round_and_increment_counters(uuid, uuid)'::regprocedure) like '%charge_session_first_start%'
      then 'BUG: still calls legacy charge_session_first_start'
    when pg_get_functiondef('public.lock_round_and_increment_counters(uuid, uuid)'::regprocedure) like '%kb_billing_consume_on_session_start%'
      then 'OK: uses kb_billing v2 / no legacy wallet double charge'
    else 'CHECK: function does not show expected billing call'
  end as lock_round_billing_check;

-- 4) Check latest LINE-related players for duplicates / missing auth link.
select
  p.id as player_id,
  p.display_name,
  p.player_code,
  p.auth_user_id,
  p.line_user_id,
  p.line_oa_user_id,
  p.created_at
from public.players p
where p.line_user_id is not null or p.line_oa_user_id is not null
order by p.created_at desc
limit 50;
