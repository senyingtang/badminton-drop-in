import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = { userId: string; delta: number; note?: string }

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

  const delta = Math.floor(Number(body.delta || 0))
  if (!Number.isFinite(delta) || delta <= 0) return json(400, { ok: false, error: 'INVALID_DELTA' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const note = String(body.note || '')
  const targetUserId = body.userId

  // Billing account
  const { data: baId } = await admin.rpc('kb_create_personal_billing_account_if_missing', {
    p_user_id: targetUserId,
  })
  const billingAccountId = Array.isArray(baId) ? baId[0] : baId

  // Find an active bucket in current period; if none, create a bonus bucket for 1 month.
  const now = new Date()
  const nowIso = now.toISOString()
  const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString()

  const { data: bucket } = await admin
    .from('kb_quota_buckets')
    .select('*')
    .eq('billing_account_id', billingAccountId)
    .eq('user_id', targetUserId)
    .lte('valid_from', nowIso)
    .gte('valid_to', nowIso)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (bucket) {
    const newTotal = Math.max(0, Number((bucket as any).quota_total ?? bucket.quota_limit ?? 0) + delta)
    const newLimit = Math.max(0, Number(bucket.quota_limit ?? 0) + delta)
    const { error } = await admin
      .from('kb_quota_buckets')
      .update({
        quota_limit: newLimit,
        quota_total: newTotal,
        source: 'admin_adjust',
        source_label: 'admin_adjust',
        status: 'active',
        metadata: { note, actor_user_id: user.id, target_user_id: targetUserId, delta },
      })
      .eq('id', bucket.id)
    if (error) return json(500, { ok: false, error: error.message })
  } else {
    const { error } = await admin.from('kb_quota_buckets').insert({
      billing_account_id: billingAccountId,
      subscription_id: null,
      user_id: targetUserId,
      bucket_type: 'bonus',
      quota_limit: Math.max(0, delta),
      quota_total: Math.max(0, delta),
      quota_used: 0,
      valid_from: nowIso,
      valid_to: in30,
      period_start: nowIso,
      period_end: in30,
      source: 'admin_bonus',
      source_label: 'admin_bonus',
      status: 'active',
      metadata: { note, actor_user_id: user.id, target_user_id: targetUserId, delta },
    })
    if (error) return json(500, { ok: false, error: error.message })
  }

  await admin.from('kb_billing_events').insert({
    session_id: null,
    billing_account_id: billingAccountId,
    user_id: targetUserId,
    event_type: 'admin_quota_adjusted',
    charged_by: 'quota',
    amount_cents: 0,
    reference_type: 'user',
    reference_id: null,
    metadata: { delta, note },
  })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: targetUserId,
    action: 'adjust_quota',
    entity_type: 'kb_quota_buckets',
    before_data: bucket || null,
    after_data: { delta, note },
    note,
  })

  return json(200, { ok: true })
}

