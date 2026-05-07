import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = { userId: string; mode?: 'immediate' | 'period_end'; note?: string }

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
  const mode = body.mode === 'period_end' ? 'period_end' : 'immediate'
  const note = String(body.note || '')

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const targetUserId = body.userId

  // Resolve billing account id via kb_billing_accounts
  const { data: ba } = await admin
    .from('kb_billing_accounts')
    .select('id')
    .eq('account_type', 'personal')
    .eq('owner_user_id', targetUserId)
    .maybeSingle()
  if (!ba?.id) return json(404, { ok: false, error: 'BILLING_ACCOUNT_NOT_FOUND' })

  const { data: sub } = await admin
    .from('kb_subscriptions')
    .select('*')
    .eq('billing_account_id', ba.id)
    .in('status', ['trialing', 'active', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!sub) return json(404, { ok: false, error: 'ACTIVE_SUBSCRIPTION_NOT_FOUND' })

  const nowIso = new Date().toISOString()
  if (mode === 'period_end') {
    await admin.from('kb_subscriptions').update({ cancel_at_period_end: true, metadata: { note } }).eq('id', sub.id)
  } else {
    await admin
      .from('kb_subscriptions')
      .update({ status: 'cancelled', cancel_at_period_end: false, canceled_at: nowIso, metadata: { note } })
      .eq('id', sub.id)
  }

  await admin.from('kb_billing_events').insert({
    session_id: null,
    billing_account_id: ba.id,
    user_id: targetUserId,
    event_type: 'admin_subscription_cancelled',
    charged_by: 'already_consumed',
    amount_cents: 0,
    reference_type: 'subscription',
    reference_id: sub.id,
    metadata: { mode, note },
  })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: targetUserId,
    action: 'cancel_subscription',
    entity_type: 'kb_subscriptions',
    entity_id: sub.id,
    before_data: sub,
    after_data: { mode, note, canceled_at: mode === 'immediate' ? nowIso : null },
    note,
  })

  return json(200, { ok: true })
}

