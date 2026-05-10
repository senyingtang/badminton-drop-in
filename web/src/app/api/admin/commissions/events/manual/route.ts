import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function commissionMonthFromIso(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

type RpcRateRow = {
  commission_item_id: string | null
  commission_item_key: string | null
  display_name: string | null
  default_rate: number | null
  personal_rate: number | null
  applied_rate: number | null
  personal_rate_active: boolean | null
}

type Body = {
  referrer_user_id: string
  referred_user_id?: string | null
  commission_item_key: string
  source_amount: number
  source_type?: string
  source_external_id?: string | null
  source_occurred_at?: string | null
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
  const sourceAmountYuan = Number(body?.source_amount)
  if (!referrerUserId || !commissionItemKey || !Number.isFinite(sourceAmountYuan) || sourceAmountYuan <= 0) {
    return json(400, { ok: false, error: 'INVALID_PAYLOAD' })
  }

  const sourceType = (body?.source_type || 'manual_test').trim() || 'manual_test'
  const occurredAt = body?.source_occurred_at?.trim() || new Date().toISOString()
  const commissionMonth = commissionMonthFromIso(occurredAt)
  const sourceAmountCents = Math.round(sourceAmountYuan * 100)

  const { data: refProf } = await admin.from('member_referral_profiles').select('referral_code').eq('user_id', referrerUserId).maybeSingle()
  if (!refProf) return json(400, { ok: false, error: 'REFERRER_HAS_NO_REFERRAL_PROFILE' })

  const referredUserId = body?.referred_user_id?.trim() || null
  if (referredUserId) {
    const { data: rp } = await admin.from('app_user_profiles').select('id').eq('id', referredUserId).maybeSingle()
    if (!rp) return json(400, { ok: false, error: 'REFERRED_PROFILE_NOT_FOUND' })
  }

  const { data: rateData, error: rateErr } = await admin.rpc('resolve_commission_rate', {
    p_referrer_user_id: referrerUserId,
    p_commission_item_key: commissionItemKey,
  })
  if (rateErr) return json(500, { ok: false, error: rateErr.message })
  const rateRow = (Array.isArray(rateData) ? rateData[0] : rateData) as RpcRateRow | undefined
  if (!rateRow?.commission_item_id || rateRow.applied_rate == null) {
    return json(400, { ok: false, error: 'COMMISSION_ITEM_INACTIVE_OR_UNKNOWN' })
  }

  const appliedRate = Number(rateRow.applied_rate)
  const commissionAmountCents = Math.floor(sourceAmountCents * appliedRate)

  let referralLinkId: string | null = null
  if (referredUserId) {
    const { data: link } = await admin
      .from('member_referral_links')
      .select('id')
      .eq('referrer_user_id', referrerUserId)
      .eq('referred_user_id', referredUserId)
      .eq('status', 'active')
      .maybeSingle()
    referralLinkId = (link?.id as string) || null
  }

  const emailSnapshot = async (uid: string | null): Promise<string | null> => {
    if (!uid) return null
    const { data: u } = await admin.auth.admin.getUserById(uid)
    return u.user?.email ?? null
  }

  const [referrerEmail, referredEmail] = await Promise.all([emailSnapshot(referrerUserId), emailSnapshot(referredUserId)])

  const rateSnapshot = {
    source: rateRow.personal_rate_active ? 'personal' : 'default',
    default_rate: rateRow.default_rate,
    personal_rate: rateRow.personal_rate,
    personal_rate_active: rateRow.personal_rate_active,
    applied_rate: appliedRate,
  }

  const sourceSnapshot = {
    manual: true,
    source_amount_yuan: sourceAmountYuan,
    source_amount_cents: sourceAmountCents,
  }

  const insertRow = {
    referrer_user_id: referrerUserId,
    referred_user_id: referredUserId,
    referral_link_id: referralLinkId,
    commission_item_id: rateRow.commission_item_id,
    commission_item_key: rateRow.commission_item_key,
    commission_item_display_name: rateRow.display_name || commissionItemKey,
    source_type: sourceType,
    source_id: null as string | null,
    source_external_id: body?.source_external_id?.trim() || null,
    source_occurred_at: occurredAt,
    source_amount_cents: sourceAmountCents,
    currency: 'TWD',
    applied_rate: appliedRate,
    commission_amount_cents: commissionAmountCents,
    event_type: 'earned' as const,
    status: 'effective' as const,
    commission_month: commissionMonth,
    referrer_referral_code: refProf.referral_code as string,
    referrer_email_snapshot: referrerEmail,
    referred_email_snapshot: referredEmail,
    source_snapshot: sourceSnapshot,
    rate_snapshot: rateSnapshot,
    note: body?.note?.trim() || null,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  }

  const { data: inserted, error: insErr } = await admin.from('commission_events').insert(insertRow).select('*').maybeSingle()
  if (insErr) {
    if (insErr.code === '23505') return json(409, { ok: false, error: 'DUPLICATE_SOURCE_EVENT' })
    return json(500, { ok: false, error: insErr.message })
  }

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: referrerUserId,
    action: 'commission_event_manual_create',
    entity_type: 'commission_events',
    entity_id: inserted?.id as string,
    before_data: null,
    after_data: inserted,
    note: body?.note?.trim() || null,
  })

  return json(200, { ok: true, event: inserted })
}
