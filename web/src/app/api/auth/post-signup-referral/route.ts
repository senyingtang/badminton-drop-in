import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { clearPendingReferralCodeFromAuthUser } from '@/lib/auth/pendingReferralMetadata'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'

export const runtime = 'nodejs'

type Body = { referralCode?: string | null }

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const body = (await req.json().catch(() => ({}))) as Body
  const raw = body.referralCode
  const code = typeof raw === 'string' && raw.trim() ? normalizeReferralCodeInput(raw) : ''

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { error: e1 } = await admin.rpc('ensure_member_referral_profile', { p_user_id: user.id })
  if (e1) return json(500, { ok: false, error: e1.message })

  if (!code) {
    return json(200, { ok: true })
  }

  if (!isValidReferralCodeFormat(code)) {
    await clearPendingReferralCodeFromAuthUser(admin, user.id)
    return json(400, { ok: false, error: 'INVALID_REFERRAL_FORMAT' })
  }

  const { error: e2 } = await admin.rpc('member_referral_try_link_after_signup', {
    p_referred_user_id: user.id,
    p_referral_code: code,
  })
  if (e2) {
    const msg = e2.message || ''
    if (/invalid_referral_code|22023/i.test(msg)) {
      await clearPendingReferralCodeFromAuthUser(admin, user.id)
      return json(400, { ok: false, error: 'INVALID_REFERRAL' })
    }
    if (/self_referral/i.test(msg)) {
      await clearPendingReferralCodeFromAuthUser(admin, user.id)
      return json(400, { ok: false, error: 'SELF_REFERRAL' })
    }
    return json(500, { ok: false, error: msg })
  }

  await clearPendingReferralCodeFromAuthUser(admin, user.id)
  return json(200, { ok: true })
}
