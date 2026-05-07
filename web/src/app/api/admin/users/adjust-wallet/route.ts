import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = { userId: string; amount_cents: number; note?: string }

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  if (!body?.userId) return json(400, { ok: false, error: 'INVALID_PAYLOAD' })

  const delta = Math.floor(Number(body.amount_cents || 0))
  if (!Number.isFinite(delta) || delta === 0) return json(400, { ok: false, error: 'INVALID_AMOUNT' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const note = String(body.note || '')
  const targetUserId = body.userId

  const { data: baId, error: baErr } = await admin.rpc('kb_create_personal_billing_account_if_missing', {
    p_user_id: targetUserId,
  })
  if (baErr) return json(500, { ok: false, error: baErr.message })
  const billingAccountId = Array.isArray(baId) ? baId[0] : baId

  const { data: wallet, error: wErr } = await admin
    .from('kb_wallets')
    .select('*')
    .eq('billing_account_id', billingAccountId)
    .maybeSingle()
  if (wErr || !wallet) return json(500, { ok: false, error: 'WALLET_NOT_FOUND' })

  const before = Number(wallet.balance_cents || 0)
  const after = before + delta
  if (after < 0) return json(400, { ok: false, error: 'WALLET_INSUFFICIENT_BALANCE' })

  await admin.from('kb_wallets').update({ balance_cents: after, balance: after / 100.0 }).eq('id', wallet.id)

  await admin.from('kb_wallet_transactions').insert({
    wallet_id: wallet.id,
    txn_type: delta > 0 ? 'topup' : 'debit_adjustment',
    amount: delta / 100.0,
    balance_before: before / 100.0,
    balance_after: after / 100.0,
    reference_type: 'admin_adjust_wallet',
    reference_id: null,
    note,
    user_id: targetUserId,
    amount_cents: Math.abs(delta),
    direction: delta > 0 ? 'credit' : 'debit',
    reason: 'manual_adjustment',
    balance_after_cents: after,
    metadata: { delta_cents: delta, note },
  })

  await admin.from('kb_billing_events').insert({
    session_id: null,
    billing_account_id: billingAccountId,
    user_id: targetUserId,
    event_type: 'admin_wallet_adjusted',
    charged_by: 'wallet',
    amount_cents: Math.abs(delta),
    reference_type: 'user',
    reference_id: null,
    metadata: { delta_cents: delta, note },
  })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: targetUserId,
    action: 'adjust_wallet',
    entity_type: 'kb_wallets',
    entity_id: wallet.id,
    before_data: { balance_cents: before },
    after_data: { balance_cents: after, delta_cents: delta },
    note,
  })

  return json(200, { ok: true, balance_cents: after })
}

