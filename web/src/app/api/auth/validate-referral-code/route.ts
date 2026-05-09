import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const raw = url.searchParams.get('code') || ''
  const code = normalizeReferralCodeInput(raw)
  if (!code) {
    return NextResponse.json({ ok: true, valid: false, reason: 'empty' })
  }
  if (!isValidReferralCodeFormat(code)) {
    return NextResponse.json({ ok: true, valid: false, reason: 'format' })
  }

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' }, { status: 500 })
  }

  const { data: referrerId, error } = await admin.rpc('member_referral_lookup_active_code', { p_code: code })
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rid = typeof referrerId === 'string' ? referrerId : null
  return NextResponse.json({ ok: true, valid: Boolean(rid) })
}
