import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = {
  userId: string
  planCode: string
  status: 'active' | 'trialing' | 'canceled' | 'cancelled' | 'suspended' | 'past_due' | 'paused'
  periodStart: string
  periodEnd: string
  quotaTotal: number
  provider: 'manual' | 'ecpay' | 'newebpay' | 'stripe' | 'other'
  autoRenew: boolean
  note?: string
}

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function mapStatus(input: Body['status']): string {
  if (input === 'canceled') return 'cancelled'
  if (input === 'suspended') return 'paused'
  return input
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
  if (!body?.userId || !body.planCode) return json(400, { ok: false, error: 'INVALID_PAYLOAD' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const targetUserId = body.userId
  const note = String(body.note || '')

  // Ensure billing account exists (personal)
  const { data: baId, error: baErr } = await admin.rpc('kb_create_personal_billing_account_if_missing', {
    p_user_id: targetUserId,
  })
  if (baErr) return json(500, { ok: false, error: baErr.message })
  const billingAccountId = Array.isArray(baId) ? baId[0] : baId

  // Resolve plan
  const { data: plan, error: planErr } = await admin
    .from('kb_plans')
    .select('id, plan_code, is_active')
    .eq('plan_code', body.planCode)
    .eq('is_active', true)
    .maybeSingle()
  if (planErr || !plan) return json(400, { ok: false, error: 'PLAN_NOT_FOUND' })

  // Cancel existing active/trialing/past_due subs for same billing account
  const { data: existing } = await admin
    .from('kb_subscriptions')
    .select('id, status, plan_id, current_period_start, current_period_end')
    .eq('billing_account_id', billingAccountId)
    .in('status', ['trialing', 'active', 'past_due'])

  if (existing && existing.length > 0) {
    for (const s of existing as any[]) {
      await admin
        .from('kb_subscriptions')
        .update({ status: 'cancelled', cancel_at_period_end: false, canceled_at: new Date().toISOString() })
        .eq('id', s.id)
    }
  }

  const status = mapStatus(body.status || 'active')
  const periodStart = body.periodStart
  const periodEnd = body.periodEnd
  const quotaTotal = Math.max(0, Math.floor(Number(body.quotaTotal || 0)))

  const { data: sub, error: subErr } = await admin
    .from('kb_subscriptions')
    .insert({
      billing_account_id: billingAccountId,
      plan_id: plan.id,
      status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      auto_renew: Boolean(body.autoRenew),
      cancel_at_period_end: false,
      provider: body.provider || 'manual',
      metadata: { note, admin_grant: true },
    })
    .select('*')
    .single()
  if (subErr) return json(500, { ok: false, error: subErr.message })

  // Create quota bucket for this period (monthly_personal)
  const { data: bucket, error: bucketErr } = await admin
    .from('kb_quota_buckets')
    .insert({
      billing_account_id: billingAccountId,
      subscription_id: sub.id,
      user_id: targetUserId,
      bucket_type: 'monthly_personal',
      quota_limit: quotaTotal,
      quota_total: quotaTotal,
      quota_used: 0,
      valid_from: periodStart,
      valid_to: periodEnd,
      period_start: periodStart,
      period_end: periodEnd,
      source_label: 'manual_admin_grant',
      source: 'manual_admin_grant',
      status: 'active',
    })
    .select('*')
    .single()
  if (bucketErr) return json(500, { ok: false, error: bucketErr.message })

  await admin.from('kb_billing_events').insert({
    session_id: null,
    billing_account_id: billingAccountId,
    user_id: targetUserId,
    event_type: 'admin_subscription_granted',
    charged_by: 'quota',
    amount_cents: 0,
    reference_type: 'subscription',
    reference_id: sub.id,
    metadata: { plan_code: body.planCode, quota_total: quotaTotal, note },
  })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: targetUserId,
    action: 'grant_subscription',
    entity_type: 'kb_subscriptions',
    entity_id: sub.id,
    before_data: { previous_active_subscriptions: existing || [] },
    after_data: { subscription: sub, quota_bucket: bucket },
    note,
  })

  return json(200, { ok: true, subscription: sub, quota_bucket: bucket })
}

