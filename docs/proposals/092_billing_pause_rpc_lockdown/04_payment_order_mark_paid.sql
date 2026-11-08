-- 092 / 04：付款成功入帳改為單一交易、可重放的資料庫函式（M1.4，為日後重新開放 ECPay 準備）
-- 狀態：提案。只在本機 PGlite 測過，見 staging-test/。需經使用者核准才可執行。
-- 執行時機：不急。線上金流維持停用（paymentGate.ts）；只需在「重新開放付款」之前套用。
--
-- 取代 App 端原本的多步驟 REST 寫入（ecpayPaymentNotify.ts 舊版）：
--   舊版問題：
--     - 更新訂單 `.eq('status','pending')` 後沒檢查影響列數，同一筆通知併發 / 重放時可能重複入帳；
--     - 錢包以「讀餘額 → 加 → 寫回」更新，兩筆不同訂單同時入帳會互相覆蓋（lost update）；
--     - 訂單、錢包、交易、帳務事件分多次寫入，中途失敗會留下「已付款但未入帳」。
--   本函式：鎖定訂單列 → 檢查狀態 / 金額 → 標記已付款 → 鎖定錢包列 → 入帳 → 寫交易與事件，全部在同一個交易。
--
-- 只授權 service_role（ECPay notify 後端），CheckMacValue / MerchantID / SimulatePaid 等檢查在 App 端先完成。
-- 不建立、不啟用訂閱（訂閱付款只把對應 invoice 標為已付款；啟用方案另行處理）。

begin;

-- 防重複入帳的最後一道防線：同一筆付款訂單只能有一筆入帳交易。
do $$
begin
  if exists (
    select reference_id from public.kb_wallet_transactions
    where reference_type = 'payment_order' and reference_id is not null
    group by reference_id having count(*) > 1
  ) then
    raise exception '092/04: kb_wallet_transactions 已存在同一 payment_order 的重複入帳，請先人工核對後再套用';
  end if;
end
$$;

create unique index if not exists uq_kb_wallet_txn_payment_order
  on public.kb_wallet_transactions (reference_id)
  where reference_type = 'payment_order';

create or replace function public.kb_payment_order_mark_paid(
  p_merchant_trade_no text,
  p_amount_cents bigint,
  p_provider_trade_no text,
  p_callback jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.kb_payment_orders%rowtype;
  v_ba uuid;
  v_wallet public.kb_wallets%rowtype;
  v_before bigint;
  v_after bigint;
  v_txn_id uuid;
  v_now timestamptz := now();
begin
  if p_merchant_trade_no is null or length(p_merchant_trade_no) = 0 then
    return jsonb_build_object('result', 'invalid_request');
  end if;

  select * into v_order from public.kb_payment_orders
  where merchant_trade_no = p_merchant_trade_no
  for update;

  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'order_id', v_order.id, 'purpose', v_order.purpose,
                              'user_id', v_order.user_id, 'amount_cents', v_order.amount_cents);
  end if;

  if v_order.status <> 'pending' then
    return jsonb_build_object('result', 'invalid_status', 'order_id', v_order.id, 'status', v_order.status);
  end if;

  if p_amount_cents is null or p_amount_cents <> v_order.amount_cents then
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  update public.kb_payment_orders
  set status = 'paid', paid_at = v_now, provider_trade_no = p_provider_trade_no,
      raw_callback = coalesce(p_callback, '{}'::jsonb), updated_at = v_now
  where id = v_order.id;

  v_ba := public.kb_create_personal_billing_account_if_missing(v_order.user_id);

  if v_order.purpose = 'wallet_topup' then
    select * into v_wallet from public.kb_wallets where billing_account_id = v_ba for update;
    if not found then
      raise exception 'WALLET_NOT_FOUND';
    end if;

    v_before := coalesce(v_wallet.balance_cents, 0);
    v_after := v_before + v_order.amount_cents;

    update public.kb_wallets
    set balance_cents = v_after, balance = v_after / 100.0, updated_at = v_now
    where id = v_wallet.id;

    insert into public.kb_wallet_transactions (
      wallet_id, txn_type, amount, balance_before, balance_after, reference_type, reference_id, note,
      user_id, amount_cents, direction, reason, balance_after_cents, metadata
    ) values (
      v_wallet.id, 'topup', v_order.amount_cents / 100.0, v_before / 100.0, v_after / 100.0,
      'payment_order', v_order.id, 'Wallet topup (verified payment notify)',
      v_order.user_id, v_order.amount_cents, 'credit', 'topup', v_after, coalesce(p_callback, '{}'::jsonb)
    )
    returning id into v_txn_id;

    insert into public.kb_billing_events (session_id, billing_account_id, user_id, event_type, charged_by,
                                          amount_cents, reference_type, reference_id, metadata)
    values (null, v_ba, v_order.user_id, 'wallet_topup_paid', 'wallet', v_order.amount_cents,
            'payment_order', v_order.id, coalesce(p_callback, '{}'::jsonb));

  elsif v_order.purpose in ('subscription_initial', 'subscription_renewal') then
    update public.kb_subscription_invoices
    set status = 'paid', paid_at = v_now, raw_callback = coalesce(p_callback, '{}'::jsonb), updated_at = v_now
    where payment_order_id = v_order.id and status = 'pending';

    insert into public.kb_billing_events (session_id, billing_account_id, user_id, event_type, charged_by,
                                          amount_cents, reference_type, reference_id, metadata)
    values (null, v_ba, v_order.user_id, 'subscription_payment_paid', 'external_payment', v_order.amount_cents,
            'payment_order', v_order.id, coalesce(p_callback, '{}'::jsonb));
  end if;

  return jsonb_build_object('result', 'paid', 'order_id', v_order.id, 'purpose', v_order.purpose,
                            'user_id', v_order.user_id, 'amount_cents', v_order.amount_cents,
                            'wallet_transaction_id', v_txn_id, 'paid_at', v_now);
end;
$$;

revoke execute on function public.kb_payment_order_mark_paid(text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.kb_payment_order_mark_paid(text, bigint, text, jsonb) to service_role;

commit;
