import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function text(status: number, body: string) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * ECPay webhook placeholder.
 * TODO:
 * - Load enabled provider config (kb_payment_provider_configs)
 * - Verify CheckMacValue
 * - Idempotent: same provider_trade_no / merchant_trade_no must not double-credit wallet
 */
export async function POST(req: Request) {
  const admin = createServiceRoleClient()
  if (!admin) return text(500, 'SERVICE_ROLE_NOT_CONFIGURED')

  const payloadText = await req.text().catch(() => '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = Object.fromEntries(new URLSearchParams(payloadText))

  const merchantTradeNo = String(payload.MerchantTradeNo || payload.merchant_trade_no || '')
  const tradeNo = String(payload.TradeNo || payload.provider_trade_no || '')
  const rtnCode = String(payload.RtnCode || payload.rtn_code || '')
  const amount = Number(payload.TradeAmt || payload.amount || 0)

  if (!merchantTradeNo) return text(400, '0|MerchantTradeNo missing')

  // Fetch order
  const { data: order, error: orderErr } = await admin
    .from('kb_payment_orders')
    .select('*')
    .eq('merchant_trade_no', merchantTradeNo)
    .maybeSingle()

  if (orderErr || !order) return text(404, '0|Order not found')
  if (order.status === 'paid') return text(200, '1|OK')

  // Basic amount check (TWD)
  if (amount && Number.isFinite(amount)) {
    const cents = Math.round(amount * 100)
    if (cents !== Number(order.amount_cents)) return text(400, '0|Amount mismatch')
  }

  if (rtnCode !== '1') {
    await admin
      .from('kb_payment_orders')
      .update({ status: 'failed', raw_callback: payload })
      .eq('id', order.id)
    return text(200, '1|OK')
  }

  // Mark paid and credit wallet (idempotent by order status)
  const userId = String(order.user_id)
  const amountCents = Number(order.amount_cents)

  // Ensure billing account + wallet exists
  const { data: baId } = await admin.rpc('kb_create_personal_billing_account_if_missing', { p_user_id: userId })
  const billingAccountId = Array.isArray(baId) ? baId[0] : baId

  // Lock wallet row
  const { data: wallet } = await admin
    .from('kb_wallets')
    .select('*')
    .eq('billing_account_id', billingAccountId)
    .maybeSingle()

  if (!wallet) return text(500, '0|Wallet not found')

  const before = Number(wallet.balance_cents || 0)
  const after = before + amountCents

  const { error: upOrderErr } = await admin
    .from('kb_payment_orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), provider_trade_no: tradeNo || null, raw_callback: payload })
    .eq('id', order.id)
    .eq('status', 'pending')

  if (upOrderErr) return text(500, '0|Order update failed')

  await admin
    .from('kb_wallets')
    .update({ balance_cents: after, balance: after / 100.0 })
    .eq('id', wallet.id)

  await admin.from('kb_wallet_transactions').insert({
    wallet_id: wallet.id,
    txn_type: 'topup',
    amount: amountCents / 100.0,
    balance_before: before / 100.0,
    balance_after: after / 100.0,
    reference_type: 'payment_order',
    reference_id: order.id,
    note: 'Wallet topup (ECPay webhook)',
    user_id: userId,
    amount_cents: amountCents,
    direction: 'credit',
    reason: 'topup',
    balance_after_cents: after,
    metadata: payload,
  })

  await admin.from('kb_billing_events').insert({
    session_id: null,
    billing_account_id: billingAccountId,
    user_id: userId,
    event_type: 'wallet_topup_paid',
    charged_by: 'wallet',
    amount_cents: amountCents,
    reference_type: 'payment_order',
    reference_id: order.id,
    metadata: payload,
  })

  return text(200, '1|OK')
}

