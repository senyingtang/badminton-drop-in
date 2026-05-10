import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { clearPendingReferralCodeFromAuthUser } from '@/lib/auth/pendingReferralMetadata'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' }, { status: 500 })
  }

  const r = await clearPendingReferralCodeFromAuthUser(admin, user.id)
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
