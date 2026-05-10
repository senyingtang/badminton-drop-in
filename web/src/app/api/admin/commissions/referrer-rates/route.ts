import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function toRateDecimal(rate: number | undefined, rate_percent: number | undefined): number | null {
  if (rate_percent !== undefined && rate_percent !== null && Number.isFinite(Number(rate_percent))) {
    return Number(rate_percent) / 100
  }
  if (rate !== undefined && rate !== null && Number.isFinite(Number(rate))) {
    return Number(rate)
  }
  return null
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const url = new URL(req.url)
  const referrerUserId = url.searchParams.get('referrerUserId')?.trim()
  if (!referrerUserId) return json(400, { ok: false, error: 'MISSING_REFERRER_USER_ID' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: items, error: iErr } = await admin.from('commission_items').select('*').order('sort_order', { ascending: true })
  if (iErr) return json(500, { ok: false, error: iErr.message })

  const { data: overrides, error: oErr } = await admin
    .from('commission_referrer_item_rates')
    .select('*')
    .eq('referrer_user_id', referrerUserId)
  if (oErr) return json(500, { ok: false, error: oErr.message })

  return json(200, { ok: true, commission_items: items || [], overrides: overrides || [] })
}

type PostBody = {
  referrer_user_id: string
  commission_item_id: string
  rate?: number
  rate_percent?: number
  is_active: boolean
  note?: string | null
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const body = (await req.json().catch(() => null)) as Partial<PostBody> | null
  if (!body) return json(400, { ok: false, error: 'INVALID_PAYLOAD' })
  const referrerUserId = body.referrer_user_id?.trim()
  const commissionItemId = body.commission_item_id?.trim()
  if (!referrerUserId || !commissionItemId) return json(400, { ok: false, error: 'INVALID_PAYLOAD' })

  const rate = toRateDecimal(body.rate, body.rate_percent)
  if (rate === null || rate < 0 || rate > 1) return json(400, { ok: false, error: 'INVALID_RATE' })

  const { data: profile } = await admin.from('app_user_profiles').select('id').eq('id', referrerUserId).maybeSingle()
  if (!profile) return json(400, { ok: false, error: 'REFERRER_PROFILE_NOT_FOUND' })

  const { data: refProf } = await admin.from('member_referral_profiles').select('user_id').eq('user_id', referrerUserId).maybeSingle()
  if (!refProf) return json(400, { ok: false, error: 'REFERRER_HAS_NO_REFERRAL_PROFILE' })

  const { data: before } = await admin
    .from('commission_referrer_item_rates')
    .select('*')
    .eq('referrer_user_id', referrerUserId)
    .eq('commission_item_id', commissionItemId)
    .maybeSingle()

  const patch = {
    rate,
    is_active: Boolean(body.is_active),
    note: body.note ?? null,
    updated_by_user_id: user.id,
  }

  let after: Record<string, unknown> | null = null
  if (before) {
    const { data: updated, error: uErr } = await admin
      .from('commission_referrer_item_rates')
      .update(patch)
      .eq('id', before.id as string)
      .select('*')
      .maybeSingle()
    if (uErr) return json(500, { ok: false, error: uErr.message })
    after = updated
  } else {
    const { data: inserted, error: iErr } = await admin
      .from('commission_referrer_item_rates')
      .insert({
        referrer_user_id: referrerUserId,
        commission_item_id: commissionItemId,
        ...patch,
        created_by_user_id: user.id,
      })
      .select('*')
      .maybeSingle()
    if (iErr) return json(500, { ok: false, error: iErr.message })
    after = inserted
  }

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: referrerUserId,
    action: 'commission_referrer_rate_upsert',
    entity_type: 'commission_referrer_item_rates',
    entity_id: (after?.id as string) || null,
    before_data: before,
    after_data: after,
    note: 'commission_referrer_rate_upsert',
  })

  return json(200, { ok: true, rate: after })
}
