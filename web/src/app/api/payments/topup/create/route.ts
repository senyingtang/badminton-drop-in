import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = {
  amount_cents?: number
  provider?: 'manual' | 'ecpay' | 'newebpay' | 'stripe' | 'other'
}

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeMerchantTradeNo(): string {
  // short unique-ish id for demo; should be replaced by stricter format per provider spec
  return `T${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

export async function POST(req: Request) {
  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: auth } = await admin.auth.getUser(req.headers.get('Authorization')?.replace('Bearer ', '') || '')
  const userId = auth?.user?.id || null
  if (!userId) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const body = (await req.json().catch(() => ({}))) as Body
  const amountCents = Math.floor(Number(body.amount_cents || 0))
  const provider = (body.provider || 'manual') as Body['provider']

  if (!Number.isFinite(amountCents) || amountCents < 10000) {
    return json(400, { ok: false, error: 'MIN_TOPUP_100', min_cents: 10000 })
  }

  const merchantTradeNo = makeMerchantTradeNo()

  const { error } = await admin.from('kb_payment_orders').insert({
    user_id: userId,
    organization_id: null,
    provider,
    merchant_trade_no: merchantTradeNo,
    amount_cents: amountCents,
    currency: 'TWD',
    purpose: 'wallet_topup',
    status: 'pending',
    raw_request: { amount_cents: amountCents, provider },
  })

  if (error) return json(500, { ok: false, error: error.message })

  // Provider not integrated yet: return manual instructions / placeholder URL.
  return json(200, {
    ok: true,
    merchant_trade_no: merchantTradeNo,
    status: 'pending',
    provider,
    payment_url: null,
    manual_instructions:
      provider === 'manual'
        ? '金流尚未啟用。請聯絡客服或平台管理員，完成手動入帳。'
        : '此金流尚未啟用，請稍後再試或改用 manual。',
  })
}

