-- 082_phase4_production_safe_verification.sql
-- Production-safe read-only checks for Phase 4（付款成功 → commission_events）。
-- 欄位對照 repo：075 commission_items.item_key、051 kb_admin_audit_logs.action、
-- app_user_profiles 無 email（001：display_name、primary_role；081 可選 is_deleted 見 diagnostics 6b）。
-- 請逐段執行；手動參數區塊已用註解標示。

-- -----------------------------------------------------------------------------
-- 1) Active commission items（item_key，不是 key）
-- -----------------------------------------------------------------------------
select
  item_key,
  display_name,
  is_active,
  default_rate,
  sort_order
from public.commission_items
where item_key in ('wallet_topup', 'subscription')
order by sort_order;

-- -----------------------------------------------------------------------------
-- 2) Active referral links（不使用 email；顯示 display_name / primary_role）
--     若 081 已套用需 is_deleted，請參考 diagnostics 檔「6b」範本自行加入欄位。
-- -----------------------------------------------------------------------------
select
  l.id,
  l.referrer_user_id,
  referrer.display_name as referrer_display_name,
  referrer.primary_role as referrer_primary_role,
  l.referred_user_id,
  referred.display_name as referred_display_name,
  referred.primary_role as referred_primary_role,
  l.status,
  l.created_at
from public.member_referral_links l
left join public.app_user_profiles referrer on referrer.id = l.referrer_user_id
left join public.app_user_profiles referred on referred.id = l.referred_user_id
where l.status = 'active'
order by l.created_at desc
limit 50;

-- -----------------------------------------------------------------------------
-- 3) 指定 referrer 的個人比例（請替換 :referrer_uuid）
-- -----------------------------------------------------------------------------
-- select
--   r.id,
--   r.referrer_user_id,
--   r.is_active as rate_row_active,
--   r.rate,
--   i.item_key,
--   i.display_name as item_display_name,
--   i.is_active as commission_item_active
-- from public.commission_referrer_item_rates r
-- join public.commission_items i on i.id = r.commission_item_id
-- where r.referrer_user_id = '00000000-0000-0000-0000-000000000000'::uuid
-- order by i.sort_order, i.item_key;

-- -----------------------------------------------------------------------------
-- 4) Recent payment orders
-- -----------------------------------------------------------------------------
select
  id,
  user_id,
  purpose,
  status,
  amount_cents,
  merchant_trade_no,
  paid_at,
  created_at
from public.kb_payment_orders
order by created_at desc
limit 40;

-- -----------------------------------------------------------------------------
-- 5) wallet_topup 且已 paid 的訂單 + 可選 wallet txn（金額以訂單為準）
-- -----------------------------------------------------------------------------
select
  po.id as payment_order_id,
  po.user_id,
  po.status,
  po.amount_cents as payment_amount_cents,
  po.merchant_trade_no,
  po.paid_at,
  wt.id as wallet_transaction_id,
  wt.amount_cents as wallet_txn_amount_cents,
  wt.user_id as wallet_txn_user_id
from public.kb_payment_orders po
left join public.kb_wallet_transactions wt
  on wt.reference_type = 'payment_order'
  and wt.reference_id = po.id
where po.purpose = 'wallet_topup'
  and po.status = 'paid'
order by po.paid_at desc nulls last, po.created_at desc
limit 30;

-- -----------------------------------------------------------------------------
-- 6) subscription 訂單且已 paid（purpose 依 048 enum）
-- -----------------------------------------------------------------------------
select
  id,
  user_id,
  purpose,
  status,
  amount_cents,
  merchant_trade_no,
  paid_at,
  created_at
from public.kb_payment_orders
where purpose in ('subscription_initial', 'subscription_renewal')
  and status = 'paid'
order by paid_at desc nulls last, created_at desc
limit 30;

-- -----------------------------------------------------------------------------
-- 7) Auto commission events
-- -----------------------------------------------------------------------------
select
  id,
  referrer_user_id,
  referred_user_id,
  commission_item_key,
  source_type,
  source_id,
  source_amount_cents,
  commission_amount_cents,
  status,
  note,
  created_at
from public.commission_events
where coalesce(metadata->>'auto', '') in ('true', '1')
   or note like '自動：%'
order by created_at desc
limit 40;

-- -----------------------------------------------------------------------------
-- 8) Auto commission audit（action 欄位）
-- -----------------------------------------------------------------------------
select
  action,
  actor_user_id,
  target_user_id,
  entity_type,
  entity_id,
  note,
  created_at
from public.kb_admin_audit_logs
where action like 'commission_event_auto_%'
order by created_at desc
limit 40;

-- -----------------------------------------------------------------------------
-- 9) Duplicate earned（同 source_type + source_id + commission_item_key）
-- -----------------------------------------------------------------------------
select
  source_type,
  source_id,
  commission_item_key,
  count(*) as n
from public.commission_events
where event_type = 'earned'
  and status = 'effective'
  and source_id is not null
group by source_type, source_id, commission_item_key
having count(*) > 1
order by n desc;

-- -----------------------------------------------------------------------------
-- 10) Effective earned summary（最近 90 日，依 referrer）
-- -----------------------------------------------------------------------------
select
  referrer_user_id,
  count(*) filter (where event_type = 'earned' and status = 'effective') as earned_effective_count,
  sum(commission_amount_cents) filter (
    where event_type = 'earned' and status = 'effective'
  ) as effective_earned_cents
from public.commission_events
where created_at > now() - interval '90 days'
group by referrer_user_id
order by effective_earned_cents desc nulls last
limit 30;
