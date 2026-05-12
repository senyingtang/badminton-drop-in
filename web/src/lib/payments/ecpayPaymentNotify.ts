import type { SupabaseClient } from '@supabase/supabase-js'
import { createCommissionEventForPayment } from '@/lib/commissions/createCommissionEventFromPayment'

export type EcpayNotifyTextResult = { status: number; body: string }

type PaymentOrderPurpose = 'wallet_topup' | 'subscription_initial' | 'subscription_renewal'

type PaymentOrderRow = {
  id: string
  user_id: string
  purpose: PaymentOrderPurpose
  status: string
  amount_cents: number
  merchant_trade_no: string
  organization_id?: string | null
  paid_at?: string | null
}

function parseEcpayPayload(payloadText: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(payloadText))
}

async function tryCommissionForPaidWalletOrder(
  admin: SupabaseClient,
  order: PaymentOrderRow,
  payload: Record<string, string>,
  tradeNo: string,
) {
  const { data: txn } = await admin
    .from('kb_wallet_transactions')
    .select('id')
    .eq('reference_type', 'payment_order')
    .eq('reference_id', order.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!txn?.id) return

  const paidAt = order.paid_at || new Date().toISOString()
  await createCommissionEventForPayment(admin, {
    referredUserId: order.user_id,
    commissionItemKey: 'wallet_topup',
    sourceType: 'wallet_topup',
    sourceId: txn.id as string,
    sourceExternalId: order.merchant_trade_no || tradeNo || null,
    sourceOccurredAt: paidAt,
    sourceAmountCents: Number(order.amount_cents),
    metadata: {
      payment: {
        purpose: order.purpose,
        payment_order_id: order.id,
        provider_trade_no: tradeNo || null,
        ecpay: payload,
      },
    },
  })
}

async function tryCommissionForPaidSubscriptionOrder(
  admin: SupabaseClient,
  order: PaymentOrderRow,
  payload: Record<string, string>,
  tradeNo: string,
) {
  const paidAt = order.paid_at || new Date().toISOString()
  await createCommissionEventForPayment(admin, {
    referredUserId: order.user_id,
    commissionItemKey: 'subscription',
    sourceType: 'subscription_payment',
    sourceId: order.id,
    sourceExternalId: order.merchant_trade_no || tradeNo || null,
    sourceOccurredAt: paidAt,
    sourceAmountCents: Number(order.amount_cents),
    metadata: {
      payment: {
        purpose: order.purpose,
        payment_order_id: order.id,
        provider_trade_no: tradeNo || null,
        ecpay: payload,
      },
    },
  })
}

/**
 * ECPay (or compatible) server notify: one entry for wallet + subscription orders.
 * Idempotent by kb_payment_orders.status === paid; commission create is separately idempotent.
 */
export async function processEcpayPaymentNotify(admin: SupabaseClient, payloadText: string): Promise<EcpayNotifyTextResult> {
  const payload = parseEcpayPayload(payloadText)
  const merchantTradeNo = String(payload.MerchantTradeNo || payload.merchant_trade_no || '')
  const tradeNo = String(payload.TradeNo || payload.provider_trade_no || '')
  const rtnCode = String(payload.RtnCode || payload.rtn_code || '')
  const amount = Number(payload.TradeAmt || payload.amount || 0)

  if (!merchantTradeNo) return { status: 400, body: '0|MerchantTradeNo missing' }

  const { data: order, error: orderErr } = await admin
    .from('kb_payment_orders')
    .select('id, user_id, organization_id, purpose, status, amount_cents, merchant_trade_no, paid_at')
    .eq('merchant_trade_no', merchantTradeNo)
    .maybeSingle()

  if (orderErr || !order) return { status: 404, body: '0|Order not found' }

  const row = order as PaymentOrderRow

  if (row.status === 'paid') {
    if (row.purpose === 'wallet_topup') {
      await tryCommissionForPaidWalletOrder(admin, row, payload, tradeNo)
    } else if (row.purpose === 'subscription_initial' || row.purpose === 'subscription_renewal') {
      await tryCommissionForPaidSubscriptionOrder(admin, row, payload, tradeNo)
    }
    return { status: 200, body: '1|OK' }
  }

  if (amount && Number.isFinite(amount)) {
    const cents = Math.round(amount * 100)
    if (cents !== Number(row.amount_cents)) return { status: 400, body: '0|Amount mismatch' }
  }

  if (rtnCode !== '1') {
    await admin
      .from('kb_payment_orders')
      .update({ status: 'failed', raw_callback: payload })
      .eq('id', row.id)
      .eq('status', 'pending')
    return { status: 200, body: '1|OK' }
  }

  const userId = String(row.user_id)
  const amountCents = Number(row.amount_cents)

  const { data: baId } = await admin.rpc('kb_create_personal_billing_account_if_missing', { p_user_id: userId })
  const billingAccountId = Array.isArray(baId) ? baId[0] : baId

  if (!billingAccountId) return { status: 500, body: '0|Billing account missing' }

  if (row.purpose === 'wallet_topup') {
    const { data: wallet } = await admin.from('kb_wallets').select('*').eq('billing_account_id', billingAccountId).maybeSingle()
    if (!wallet) return { status: 500, body: '0|Wallet not found' }

    const before = Number(wallet.balance_cents || 0)
    const after = before + amountCents

    const { error: upOrderErr } = await admin
      .from('kb_payment_orders')
      .update({ status: 'paid', paid_at: new Date().toISOString(), provider_trade_no: tradeNo || null, raw_callback: payload })
      .eq('id', row.id)
      .eq('status', 'pending')

    if (upOrderErr) return { status: 500, body: '0|Order update failed' }

    await admin
      .from('kb_wallets')
      .update({ balance_cents: after, balance: after / 100.0 })
      .eq('id', wallet.id)

    const { data: txnRow, error: txnErr } = await admin
      .from('kb_wallet_transactions')
      .insert({
        wallet_id: wallet.id,
        txn_type: 'topup',
        amount: amountCents / 100.0,
        balance_before: before / 100.0,
        balance_after: after / 100.0,
        reference_type: 'payment_order',
        reference_id: row.id,
        note: 'Wallet topup (ECPay webhook)',
        user_id: userId,
        amount_cents: amountCents,
        direction: 'credit',
        reason: 'topup',
        balance_after_cents: after,
        metadata: payload,
      })
      .select('id')
      .maybeSingle()

    if (txnErr || !txnRow?.id) return { status: 500, body: '0|Wallet txn insert failed' }

    await admin.from('kb_billing_events').insert({
      session_id: null,
      billing_account_id: billingAccountId,
      user_id: userId,
      event_type: 'wallet_topup_paid',
      charged_by: 'wallet',
      amount_cents: amountCents,
      reference_type: 'payment_order',
      reference_id: row.id,
      metadata: payload,
    })

    await createCommissionEventForPayment(admin, {
      referredUserId: userId,
      commissionItemKey: 'wallet_topup',
      sourceType: 'wallet_topup',
      sourceId: txnRow.id as string,
      sourceExternalId: row.merchant_trade_no || tradeNo || null,
      sourceOccurredAt: new Date().toISOString(),
      sourceAmountCents: amountCents,
      metadata: {
        payment: {
          purpose: row.purpose,
          payment_order_id: row.id,
          wallet_transaction_id: txnRow.id,
          provider_trade_no: tradeNo || null,
          ecpay: payload,
        },
      },
    })

    return { status: 200, body: '1|OK' }
  }

  if (row.purpose === 'subscription_initial' || row.purpose === 'subscription_renewal') {
    const paidAt = new Date().toISOString()

    const { error: upOrderErr } = await admin
      .from('kb_payment_orders')
      .update({ status: 'paid', paid_at: paidAt, provider_trade_no: tradeNo || null, raw_callback: payload })
      .eq('id', row.id)
      .eq('status', 'pending')

    if (upOrderErr) return { status: 500, body: '0|Order update failed' }

    await admin.from('kb_billing_events').insert({
      session_id: null,
      billing_account_id: billingAccountId,
      user_id: userId,
      event_type: 'subscription_payment_paid',
      charged_by: 'external_payment',
      amount_cents: amountCents,
      reference_type: 'payment_order',
      reference_id: row.id,
      metadata: payload,
    })

    await admin
      .from('kb_subscription_invoices')
      .update({ status: 'paid', paid_at: paidAt, raw_callback: payload })
      .eq('payment_order_id', row.id)
      .eq('status', 'pending')

    await createCommissionEventForPayment(admin, {
      referredUserId: userId,
      commissionItemKey: 'subscription',
      sourceType: 'subscription_payment',
      sourceId: row.id,
      sourceExternalId: row.merchant_trade_no || tradeNo || null,
      sourceOccurredAt: paidAt,
      sourceAmountCents: amountCents,
      metadata: {
        payment: {
          purpose: row.purpose,
          payment_order_id: row.id,
          provider_trade_no: tradeNo || null,
          ecpay: payload,
        },
      },
    })

    return { status: 200, body: '1|OK' }
  }

  return { status: 400, body: '0|Unsupported payment purpose' }
}
