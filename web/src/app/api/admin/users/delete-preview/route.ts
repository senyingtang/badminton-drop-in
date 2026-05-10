import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { buildUserHardDeletePreview } from '@/lib/admin/userHardDeletePreview'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

type Body = { userId: string }

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  const userId = body?.userId?.trim()
  if (!userId) return json(400, { ok: false, error: 'INVALID_PAYLOAD' })

  if (userId === user.id) return json(400, { ok: false, error: 'CANNOT_DELETE_SELF' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  try {
    const preview = await buildUserHardDeletePreview(admin, userId)
    return json(200, {
      ok: true,
      preview: {
        userId: preview.userId,
        email: preview.email,
        displayName: preview.displayName,
        role: preview.primaryRole,
        playersCount: preview.playersCount,
        sessionsHostedCount: preview.sessionsHostedCount,
        sessionsCreatedCount: preview.sessionsCreatedCount,
        sessionParticipantsCount: preview.sessionParticipantsCount,
        walletBalanceCents: preview.walletBalanceCents,
        walletTransactionsCount: preview.walletTransactionsCount,
        billingEventsCount: preview.billingEventsCount,
        referralLinksCount: preview.referralLinksCount,
        subscriptionsCount: preview.subscriptionsCount,
        paymentOrdersCount: preview.paymentOrdersCount,
        matchScoreSubmissionsCount: preview.matchScoreSubmissionsCount,
        sessionWaitlistPromotionsCount: preview.sessionWaitlistPromotionsCount,
        venuesOwnedCount: preview.venuesOwnedCount,
        pickupGroupsOwnedCount: preview.pickupGroupsOwnedCount,
        hostSessionRequestsCount: preview.hostSessionRequestsCount,
        canHardDelete: preview.canHardDelete,
        blockReasons: preview.blockReasons,
        riskHints: preview.riskHints,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'PREVIEW_FAILED'
    return json(400, { ok: false, error: msg })
  }
}
