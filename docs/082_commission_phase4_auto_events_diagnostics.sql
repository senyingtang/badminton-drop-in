-- 082_commission_phase4_auto_events_diagnostics.sql
-- Read-only diagnostics for Phase 4 auto commission_events from payments.
-- Run sections in Supabase SQL Editor one block at a time.
--
-- Schema 依 repo：075 (commission_items.item_key)、076 (commission_events)、
-- 051 (kb_admin_audit_logs.action)、048/005 (kb_payment_orders, kb_wallet_transactions)、
-- 001+081 (app_user_profiles：無 email；有 display_name、primary_role；081 起有 is_deleted)。
-- 若欄位與貴環境不符，請先執行下方「0) Schema introspection」對照。

-- =============================================================================
-- 0) Schema introspection（Production 欄位核對）
-- =============================================================================

-- 0a) commission_items
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'commission_items'
order by ordinal_position;

-- 0b) app_user_profiles
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'app_user_profiles'
order by ordinal_position;

-- 0c) member_referral_links
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'member_referral_links'
order by ordinal_position;

-- 0d) member_referral_profiles
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'member_referral_profiles'
order by ordinal_position;

-- 0e) commission_referrer_item_rates
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'commission_referrer_item_rates'
order by ordinal_position;

-- 0f) commission_events
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'commission_events'
order by ordinal_position;

-- 0g) kb_admin_audit_logs
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'kb_admin_audit_logs'
order by ordinal_position;

-- 0h) kb_payment_orders
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'kb_payment_orders'
order by ordinal_position;

-- 0i) kb_wallet_transactions
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'kb_wallet_transactions'
order by ordinal_position;

-- =============================================================================
-- 1) commission_items：wallet_topup / subscription（實際 key 欄位為 item_key，非 key）
-- =============================================================================
select
  item_key,
  display_name,
  is_active,
  default_rate,
  sort_order
from public.commission_items
where item_key in ('wallet_topup', 'subscription')
order by sort_order;

-- =============================================================================
-- 2) Recent payment orders（金額以 amount_cents 為準）
-- =============================================================================
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
limit 25;

-- =============================================================================
-- 3) 儲值訂單 + 可選 wallet txn（金額以 payment_orders.amount_cents 為主；wallet 欄位可為 null）
-- =============================================================================
select
  po.id as payment_order_id,
  po.user_id,
  po.status,
  po.purpose,
  po.amount_cents as payment_amount_cents,
  po.merchant_trade_no,
  po.paid_at,
  wt.id as wallet_transaction_id,
  wt.txn_type,
  wt.reference_type,
  wt.reference_id,
  wt.amount as wallet_amount_numeric,
  wt.amount_cents as wallet_amount_cents,
  wt.user_id as wallet_txn_user_id,
  po.created_at
from public.kb_payment_orders po
left join public.kb_wallet_transactions wt
  on wt.reference_type = 'payment_order'
  and wt.reference_id = po.id
where po.purpose = 'wallet_topup'
order by po.created_at desc
limit 25;

-- =============================================================================
-- 4) Recent subscription-related billing events
-- =============================================================================
select
  id,
  user_id,
  event_type,
  amount_cents,
  reference_type,
  reference_id,
  created_at
from public.kb_billing_events
where event_type in ('subscription_payment_paid', 'admin_subscription_granted', 'admin_subscription_cancelled')
order by created_at desc
limit 25;

-- =============================================================================
-- 5) Recent subscription invoices（若表不存在請略過；依 048 schema）
-- =============================================================================
select
  si.id,
  si.subscription_id,
  si.user_id,
  si.status,
  si.amount_cents,
  si.payment_order_id,
  si.paid_at,
  si.created_at
from public.kb_subscription_invoices si
order by si.created_at desc
limit 25;

-- =============================================================================
-- 6) Active referral links + profile 顯示（不使用 email；app_user_profiles 無 email 欄位）
--     僅使用 001_base_schema 即有之 display_name、primary_role。
--     若已執行 081 且有 is_deleted，可改用下方「6b」查詢。
-- =============================================================================
select
  l.id,
  l.referrer_user_id,
  referrer.display_name as referrer_display_name,
  referrer.primary_role as referrer_primary_role,
  l.referred_user_id,
  referred.display_name as referred_display_name,
  referred.primary_role as referred_primary_role,
  l.status,
  l.referral_code_used,
  l.created_at
from public.member_referral_links l
left join public.app_user_profiles referrer on referrer.id = l.referrer_user_id
left join public.app_user_profiles referred on referred.id = l.referred_user_id
where l.status = 'active'
order by l.created_at desc
limit 30;

-- 6b) 同上 + is_deleted（需 081 後 app_user_profiles 才有 is_deleted 欄位）
-- select
--   l.id,
--   l.referrer_user_id,
--   referrer.display_name as referrer_display_name,
--   referrer.primary_role as referrer_primary_role,
--   referrer.is_deleted as referrer_is_deleted,
--   l.referred_user_id,
--   referred.display_name as referred_display_name,
--   referred.primary_role as referred_primary_role,
--   referred.is_deleted as referred_is_deleted,
--   l.status,
--   l.referral_code_used,
--   l.created_at
-- from public.member_referral_links l
-- left join public.app_user_profiles referrer on referrer.id = l.referrer_user_id
-- left join public.app_user_profiles referred on referred.id = l.referred_user_id
-- where l.status = 'active'
-- order by l.created_at desc
-- limit 30;

-- =============================================================================
-- 7) Recent auto commission_events（metadata.auto 或 note 前綴）
-- =============================================================================
select
  id,
  referrer_user_id,
  referred_user_id,
  commission_item_key,
  source_type,
  source_id,
  source_external_id,
  source_amount_cents,
  applied_rate,
  commission_amount_cents,
  event_type,
  status,
  note,
  metadata,
  created_at
from public.commission_events
where coalesce(metadata->>'auto', '') in ('true', '1')
   or note like '自動：%'
order by created_at desc
limit 40;

-- =============================================================================
-- 8) Duplicate-risk：同一 source_type + source_id + commission_item_key 多筆 effective earned（應為 0）
-- =============================================================================
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
order by n desc
limit 50;

-- =============================================================================
-- 9) resolve_commission_rate 範例（手動替換 UUID 與 item_key 後執行）
-- =============================================================================
-- select *
-- from public.resolve_commission_rate(
--   '00000000-0000-0000-0000-000000000001'::uuid,  -- referrer_user_id（app_user_profiles.id）
--   'wallet_topup'                                 -- commission_items.item_key
-- );

-- =============================================================================
-- 10) Phase 4 自動分潤 audit（欄位名為 action，不是 action_type）
-- =============================================================================
select
  id,
  action,
  actor_user_id,
  target_user_id,
  entity_type,
  entity_id,
  before_data,
  after_data,
  note,
  created_at
from public.kb_admin_audit_logs
where action like 'commission_event_auto_%'
order by created_at desc
limit 60;

-- =============================================================================
-- 11) Effective earned totals last 90 days by referrer（member summary  sanity）
-- =============================================================================
select
  referrer_user_id,
  sum(commission_amount_cents) filter (
    where status = 'effective' and event_type = 'earned'
  ) as effective_earned_cents
from public.commission_events
where created_at > now() - interval '90 days'
group by referrer_user_id
order by effective_earned_cents desc nulls last
limit 20;
