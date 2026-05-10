import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { buildUserHardDeletePreview, DbOpError } from '@/lib/admin/userHardDeletePreview'

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
  if (!user?.id) return json(401, { ok: false, code: 'UNAUTHENTICATED', message: '未登入' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, code: 'FORBIDDEN', message: '權限不足' })

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  const userId = body?.userId?.trim()
  if (!userId) return json(400, { ok: false, code: 'INVALID_PAYLOAD', message: '缺少 userId' })

  if (userId === user.id) return json(400, { ok: false, code: 'CANNOT_DELETE_SELF', message: '不可刪除自己' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, code: 'SERVICE_ROLE_NOT_CONFIGURED', message: 'Service role 未設定' })

  try {
    const preview = await buildUserHardDeletePreview(admin, userId)
    const reasons = [
      { key: 'players', label: 'players', count: preview.playersCount, message: `players：共有 ${preview.playersCount} 筆` },
      {
        key: 'sessions_hosted',
        label: 'sessions.host_user_id',
        count: preview.sessionsHostedCount,
        message: `sessions(host_user_id)：共有 ${preview.sessionsHostedCount} 筆`,
      },
      {
        key: 'sessions_created',
        label: 'sessions.created_by_user_id',
        count: preview.sessionsCreatedCount,
        message: `sessions(created_by_user_id)：共有 ${preview.sessionsCreatedCount} 筆`,
      },
      {
        key: 'session_participants',
        label: 'session_participants',
        count: preview.sessionParticipantsCount,
        message: `session_participants：共有 ${preview.sessionParticipantsCount} 筆`,
      },
      {
        key: 'match_score_submissions',
        label: 'match_score_submissions',
        count: preview.matchScoreSubmissionsCount,
        message: `match_score_submissions：共有 ${preview.matchScoreSubmissionsCount} 筆`,
      },
      {
        key: 'wallet_transactions',
        label: 'kb_wallet_transactions',
        count: preview.walletTransactionsCount,
        message: `kb_wallet_transactions：共有 ${preview.walletTransactionsCount} 筆`,
      },
      { key: 'billing_events', label: 'kb_billing_events', count: preview.billingEventsCount, message: `kb_billing_events：共有 ${preview.billingEventsCount} 筆` },
      { key: 'subscriptions', label: 'kb_subscriptions', count: preview.subscriptionsCount, message: `kb_subscriptions：共有 ${preview.subscriptionsCount} 筆` },
      { key: 'payment_orders', label: 'kb_payment_orders', count: preview.paymentOrdersCount, message: `kb_payment_orders：共有 ${preview.paymentOrdersCount} 筆` },
      { key: 'referral_links', label: 'member_referral_links', count: preview.referralLinksCount, message: `member_referral_links：共有 ${preview.referralLinksCount} 筆` },
    ]

    const blockedReasons =
      preview.blockReasons.length > 0
        ? preview.blockReasons.map((m, i) => ({ key: `block_${i}`, label: 'blocked', message: m }))
        : reasons
            .filter((r) => (r.count ?? 0) > 0)
            .map((r) => ({ ...r, message: `${r.label}：共有 ${r.count} 筆紀錄，無法永久刪除` }))

    return json(200, {
      ok: true,
      data: {
        userId: preview.userId,
        email: preview.email,
        displayName: preview.displayName,
        role: preview.primaryRole,
        canHardDelete: preview.canHardDelete,
        riskHints: preview.riskHints,
        counts: {
          players: preview.playersCount,
          sessionsHosted: preview.sessionsHostedCount,
          sessionsCreated: preview.sessionsCreatedCount,
          participants: preview.sessionParticipantsCount,
          matchScoreSubmissions: preview.matchScoreSubmissionsCount,
          walletBalanceCents: preview.walletBalanceCents,
          walletTransactions: preview.walletTransactionsCount,
          billingEvents: preview.billingEventsCount,
          referralLinks: preview.referralLinksCount,
          subscriptions: preview.subscriptionsCount,
          paymentOrders: preview.paymentOrdersCount,
        },
        reasons: preview.canHardDelete ? [] : blockedReasons,
        blockReasons: preview.blockReasons,
      },
    })
  } catch (e) {
    if (e instanceof DbOpError) {
      return json(400, {
        ok: false,
        code: 'QUERY_ERROR',
        message: `${e.table}：查詢失敗，原因：${e.message}`,
        reasons: [
          {
            key: e.table,
            label: e.table,
            message: `${e.table}：查詢失敗，原因：${e.message}`,
          },
        ],
        debug: { table: e.table, operation: e.operation, message: e.message, code: e.code, details: e.details },
      })
    }
    const msg = e instanceof Error ? e.message : 'PREVIEW_FAILED'
    return json(400, { ok: false, code: 'PREVIEW_FAILED', message: msg })
  }
}
