import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function commissionMonthFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

type Body = {
  original_event_id?: string | null
  referrer_user_id: string
  commission_item_key: string
  adjustment_amount: number
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

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  const referrerUserId = body?.referrer_user_id?.trim()
  const commissionItemKey = body?.commission_item_key?.trim()
  const adjYuan = Number(body?.adjustment_amount)
  if (!referrerUserId || !commissionItemKey || !Number.isFinite(adjYuan)) {
    return json(400, { ok: false, error: 'INVALID_PAYLOAD' })
  }

  const adjustmentCents = Math.round(adjYuan * 100)

  const { data: refProf } = await admin.from('member_referral_profiles').select('referral_code').eq('user_id', referrerUserId).maybeSingle()
  if (!refProf) return json(400, { ok: false, error: 'REFERRER_HAS_NO_REFERRAL_PROFILE' })

  const { data: item } = await admin.from('commission_items').select('id, display_name').eq('item_key', commissionItemKey).maybeSingle()
  if (!item) return json(400, { ok: false, error: 'UNKNOWN_ITEM_KEY' })

  let commissionMonth = commissionMonthFromDate(new Date())
  let original: Record<string, unknown> | null = null
  const origId = body?.original_event_id?.trim() || null
  if (origId) {
    const { data: orig } = await admin.from('commission_events').select('*').eq('id', origId).maybeSingle()
    if (!orig) return json(404, { ok: false, error: 'ORIGINAL_NOT_FOUND' })
    original = orig as Record<string, unknown>
    if (typeof orig.commission_month === 'string') {
      commissionMonth = orig.commission_month
    }
  }

  const { data: refEmail } = await admin.auth.admin.getUserById(referrerUserId)

  const insertRow = {
    referrer_user_id: referrerUserId,
    referred_user_id: null as string | null,
    referral_link_id: null as string | null,
    commission_item_id: item.id as string,
    commission_item_key: commissionItemKey,
    commission_item_display_name: item.display_name as string,
    source_type: 'admin_adjustment',
    source_id: null as string | null,
    source_external_id: null as string | null,
    source_occurred_at: new Date().toISOString(),
    source_amount_cents: 0,
    currency: 'TWD',
    applied_rate: 0,
    commission_amount_cents: adjustmentCents,
    event_type: 'adjustment' as const,
    status: 'effective' as const,
    commission_month: commissionMonth,
    referrer_referral_code: refProf.referral_code as string,
    referrer_email_snapshot: refEmail.user?.email ?? null,
    referred_email_snapshot: null as string | null,
    source_snapshot: { adjustment_amount_yuan: adjYuan, adjustment_amount_cents: adjustmentCents },
    rate_snapshot: { applied_rate: 0, note: 'adjustment' },
    note: body?.note?.trim() || null,
    adjusted_from_event_id: origId,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  }

  const { data: inserted, error: insErr } = await admin.from('commission_events').insert(insertRow).select('*').maybeSingle()
  if (insErr) return json(500, { ok: false, error: insErr.message })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: referrerUserId,
    action: 'commission_event_adjust',
    entity_type: 'commission_events',
    entity_id: inserted?.id as string,
    before_data: original,
    after_data: inserted,
    note: body?.note?.trim() || null,
  })

  return json(200, { ok: true, event: inserted })
}
