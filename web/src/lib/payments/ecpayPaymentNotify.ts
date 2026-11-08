import type { SupabaseClient } from '@supabase/supabase-js'
import { createCommissionEventForPayment } from '@/lib/commissions/createCommissionEventFromPayment'
import { verifyEcpayNotify, type EcpayConfig, type VerifiedEcpayNotify } from './ecpay/verifyNotify'

export type EcpayNotifyTextResult = { status: number; body: string }

type MarkPaidResult =
  | { result: 'paid'; order_id: string; purpose: string; user_id: string; amount_cents: number; wallet_transaction_id: string | null; paid_at: string }
  | { result: 'already_paid'; order_id: string; purpose: string; user_id: string; amount_cents: number }
  | { result: 'not_found' | 'invalid_request' }
  | { result: 'amount_mismatch'; order_id: string }
  | { result: 'invalid_status'; order_id: string; status: string }

type CommissionFn = typeof createCommissionEventForPayment

export type EcpayNotifyDeps = {
  createCommission?: CommissionFn
}

const ok = (): EcpayNotifyTextResult => ({ status: 200, body: '1|OK' })
const fail = (status: number, code: string): EcpayNotifyTextResult => ({ status, body: `0|${code}` })

async function createCommission(
  admin: SupabaseClient,
  createFn: CommissionFn,
  verified: VerifiedEcpayNotify,
  order: { order_id: string; purpose: string; user_id: string; amount_cents: number },
  walletTxnId: string | null,
  paidAt: string,
) {
  const isWallet = order.purpose === 'wallet_topup'
  let sourceId = isWallet ? walletTxnId : order.order_id
  if (isWallet && !sourceId) {
    // 重放（already_paid）時找回當初的入帳交易；分潤由部分唯一索引（076）去重
    const { data: txn } = await admin
      .from('kb_wallet_transactions')
      .select('id')
      .eq('reference_type', 'payment_order')
      .eq('reference_id', order.order_id)
      .limit(1)
      .maybeSingle()
    sourceId = (txn?.id as string | undefined) ?? null
  }
  if (!sourceId) return

  await createFn(admin, {
    referredUserId: order.user_id,
    commissionItemKey: isWallet ? 'wallet_topup' : 'subscription',
    sourceType: isWallet ? 'wallet_topup' : 'subscription_payment',
    sourceId,
    sourceExternalId: verified.merchantTradeNo || verified.tradeNo || null,
    sourceOccurredAt: paidAt,
    sourceAmountCents: Number(order.amount_cents),
    metadata: {
      payment: {
        purpose: order.purpose,
        payment_order_id: order.order_id,
        wallet_transaction_id: walletTxnId,
        provider_trade_no: verified.tradeNo || null,
        ecpay: verified.payload,
      },
    },
  })
}

/**
 * ECPay server notify（錢包儲值 + 訂閱付款）。
 *
 * 安全順序（任何一步失敗都「不」寫入）：
 *   1. 商店設定必須存在（ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV，伺服器祕密）
 *   2. verifyEcpayNotify：CheckMacValue、MerchantID、MerchantTradeNo、TradeAmt、SimulatePaid
 *   3. RtnCode ≠ 1：只把 pending 訂單標為 failed（不入帳）
 *   4. kb_payment_order_mark_paid（DB 單一交易，docs/proposals/092/04）：鎖訂單 → 狀態 / 金額檢查 →
 *      標記已付款 → 鎖錢包 → 入帳。已付款的重放回傳 already_paid，不會重複入帳
 *   5. 付款成立後才建立分潤事件（分潤本身另有唯一索引去重）
 */
export async function processEcpayPaymentNotify(
  admin: SupabaseClient,
  payloadText: string,
  config: EcpayConfig | null,
  deps: EcpayNotifyDeps = {},
): Promise<EcpayNotifyTextResult> {
  if (!config) return fail(503, 'ECPAY_NOT_CONFIGURED')

  const verified = await verifyEcpayNotify(payloadText, config)
  if (!verified.ok) return fail(400, verified.reason)

  if (verified.rtnCode !== '1') {
    await admin
      .from('kb_payment_orders')
      .update({ status: 'failed', raw_callback: verified.payload })
      .eq('merchant_trade_no', verified.merchantTradeNo)
      .eq('status', 'pending')
    return ok()
  }

  const { data, error } = await admin.rpc('kb_payment_order_mark_paid', {
    p_merchant_trade_no: verified.merchantTradeNo,
    p_amount_cents: verified.amountCents,
    p_provider_trade_no: verified.tradeNo || null,
    p_callback: verified.payload,
  })
  if (error) return fail(500, 'MARK_PAID_FAILED')

  const r = data as MarkPaidResult | null
  const createFn = deps.createCommission ?? createCommissionEventForPayment

  switch (r?.result) {
    case 'paid':
      await createCommission(admin, createFn, verified, r, r.wallet_transaction_id, r.paid_at)
      return ok()
    case 'already_paid':
      await createCommission(admin, createFn, verified, r, null, new Date().toISOString())
      return ok()
    case 'not_found':
      return fail(404, 'ORDER_NOT_FOUND')
    case 'amount_mismatch':
      return fail(400, 'AMOUNT_MISMATCH')
    case 'invalid_status':
      return fail(409, 'INVALID_ORDER_STATUS')
    default:
      return fail(500, 'UNEXPECTED_RESULT')
  }
}
