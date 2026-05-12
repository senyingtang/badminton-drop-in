-- 082_commission_phase4_auto_events_diagnostics.sql
-- Read-only diagnostics for Phase 4 auto commission_events from payments.

-- 1) commission_items: wallet_topup / subscription active flags
select item_key, display_name, is_active, default_rate, sort_order
from public.commission_items
where item_key in ('wallet_topup', 'subscription')
order by sort_order;

-- 2) Recent payment orders (all purposes)
select id, user_id, purpose, status, amount_cents, merchant_trade_no, paid_at, created_at
from public.kb_payment_orders
order by created_at desc
limit 25;

-- 3) Recent wallet top-up txns tied to payment_order
select wt.id, wt.user_id, wt.amount_cents, wt.reference_type, wt.reference_id, wt.created_at
from public.kb_wallet_transactions wt
where wt.txn_type = 'topup'
  and wt.reference_type = 'payment_order'
order by wt.created_at desc
limit 25;

-- 4) Recent subscription-related billing events
select id, user_id, event_type, amount_cents, reference_type, reference_id, created_at
from public.kb_billing_events
where event_type in ('subscription_payment_paid', 'admin_subscription_granted', 'admin_subscription_cancelled')
order by created_at desc
limit 25;

-- 5) Recent paid subscription invoices (if any)
select si.id, si.subscription_id, si.user_id, si.status, si.amount_cents, si.payment_order_id, si.paid_at, si.created_at
from public.kb_subscription_invoices si
order by si.created_at desc
limit 25;

-- 6) Payers with active referral links (who was referred)
select mrl.referred_user_id, mrl.referrer_user_id, mrl.status, mrl.created_at
from public.member_referral_links mrl
where mrl.status = 'active'
order by mrl.created_at desc
limit 30;

-- 7) Recent auto-created commission_events (note / metadata)
select id, referrer_user_id, referred_user_id, commission_item_key, source_type, source_id,
       source_external_id, source_amount_cents, applied_rate, commission_amount_cents,
       event_type, status, note, metadata, created_at
from public.commission_events
where coalesce(metadata->>'auto', '') = 'true'
   or note like '自動：%'
order by created_at desc
limit 40;

-- 8) Duplicate-risk: multiple earned rows same source_type + source_id + item (should be 0)
select source_type, source_id, commission_item_key, count(*) as n
from public.commission_events
where event_type = 'earned'
  and status = 'effective'
  and source_id is not null
group by 1, 2, 3
having count(*) > 1
order by n desc
limit 50;

-- 9) resolve_commission_rate sample (replace :referrer and :item)
-- select * from public.resolve_commission_rate(:referrer::uuid, :item);

-- 10) Recent Phase 4 audit actions
select id, actor_user_id, target_user_id, action, entity_type, entity_id, note, created_at
from public.kb_admin_audit_logs
where action in (
  'commission_event_auto_create',
  'commission_event_auto_skip',
  'commission_event_auto_duplicate',
  'commission_event_auto_error'
)
order by created_at desc
limit 60;

-- 11) Member summary sanity: effective earned totals last 90 days by referrer
select referrer_user_id,
       sum(commission_amount_cents) filter (where status = 'effective' and event_type = 'earned') as effective_earned_cents
from public.commission_events
where created_at > now() - interval '90 days'
group by 1
order by effective_earned_cents desc nulls last
limit 20;
