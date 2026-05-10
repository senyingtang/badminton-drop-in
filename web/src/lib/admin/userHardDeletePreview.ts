import type { SupabaseClient } from '@supabase/supabase-js'

export type UserDeletePreview = {
  userId: string
  email: string | null
  displayName: string | null
  primaryRole: string | null
  profileExists: boolean
  playersCount: number
  sessionsHostedCount: number
  sessionsCreatedCount: number
  sessionParticipantsCount: number
  walletBalanceCents: number
  walletTransactionsCount: number
  billingEventsCount: number
  referralLinksCount: number
  subscriptionsCount: number
  paymentOrdersCount: number
  matchScoreSubmissionsCount: number
  sessionWaitlistPromotionsCount: number
  venuesOwnedCount: number
  pickupGroupsOwnedCount: number
  hostSessionRequestsCount: number
  canHardDelete: boolean
  blockReasons: string[]
  riskHints: string[]
}

export class DbOpError extends Error {
  table: string
  operation: string
  code?: string
  details?: string

  constructor(args: { table: string; operation: string; message: string; code?: string; details?: string }) {
    super(args.message)
    this.table = args.table
    this.operation = args.operation
    this.code = args.code
    this.details = args.details
  }
}

async function countExact(
  admin: SupabaseClient,
  table: string,
  // Postgrest builder chain types are too narrow for a shared helper; keep this local.
  filters: (q: { eq: (c: string, v: string) => unknown; in: (c: string, v: string[]) => unknown }) => unknown
): Promise<number> {
  let q = admin.from(table).select('*', { count: 'exact', head: true })
  q = filters(q as never) as typeof q
  const { count, error } = await q
  if (error) {
    throw new DbOpError({
      table,
      operation: 'countExact',
      message: error.message,
      code: (error as unknown as { code?: string }).code,
      details: (error as unknown as { details?: string }).details,
    })
  }
  return count ?? 0
}

export async function buildUserHardDeletePreview(
  admin: SupabaseClient,
  userId: string
): Promise<UserDeletePreview> {
  const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(userId)
  if (authErr) {
    throw new DbOpError({
      table: 'auth.users',
      operation: 'auth.admin.getUserById',
      message: authErr.message,
      code: (authErr as unknown as { code?: string }).code,
      details: (authErr as unknown as { details?: string }).details,
    })
  }
  const email = authRes.user?.email ?? null

  const { data: profile } = await admin.from('app_user_profiles').select('display_name, primary_role').eq('id', userId).maybeSingle()

  const { data: playerRows } = await admin.from('players').select('id').eq('auth_user_id', userId)
  const playerIds = (playerRows || []).map((r) => r.id as string)
  const playersCount = playerIds.length

  const sessionsHostedCount = await countExact(admin, 'sessions', (q) => q.eq('host_user_id', userId))
  const sessionsCreatedCount = await countExact(admin, 'sessions', (q) => q.eq('created_by_user_id', userId))

  let sessionParticipantsCount = 0
  if (playerIds.length > 0) {
    sessionParticipantsCount = await countExact(admin, 'session_participants', (q) => q.in('player_id', playerIds))
  }

  const { data: personalBa } = await admin
    .from('kb_billing_accounts')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('account_type', 'personal')
    .maybeSingle()

  let walletBalanceCents = 0
  let walletTransactionsCount = 0
  if (personalBa?.id) {
    const { data: wallet } = await admin.from('kb_wallets').select('id, balance_cents').eq('billing_account_id', personalBa.id).maybeSingle()
    walletBalanceCents = Number(wallet?.balance_cents ?? 0)
    if (wallet?.id) {
      walletTransactionsCount = await countExact(admin, 'kb_wallet_transactions', (q) => q.eq('wallet_id', wallet.id))
    }
  }

  const billingEventsCount = await countExact(admin, 'kb_billing_events', (q) => q.eq('user_id', userId))

  let subscriptionsCount = 0
  if (personalBa?.id) {
    subscriptionsCount = await countExact(admin, 'kb_subscriptions', (q) => q.eq('billing_account_id', personalBa.id))
  }

  const paymentOrdersCount = await countExact(admin, 'kb_payment_orders', (q) => q.eq('user_id', userId))

  const refAsRef = await countExact(admin, 'member_referral_links', (q) => q.eq('referrer_user_id', userId))
  const refAsRec = await countExact(admin, 'member_referral_links', (q) => q.eq('referred_user_id', userId))
  const referralLinksCount = refAsRef + refAsRec

  const venuesOwnedCount = await countExact(admin, 'venues', (q) => q.eq('owner_user_id', userId))
  const pickupGroupsOwnedCount = await countExact(admin, 'pickup_groups', (q) => q.eq('owner_user_id', userId))
  const hostSessionRequestsCount = await countExact(admin, 'host_session_requests', (q) => q.eq('host_user_id', userId))

  const sessionWaitlistPromotionsCount = await countExact(admin, 'session_waitlist_promotions', (q) =>
    q.eq('promoted_by_user_id', userId)
  )

  // Production: match_score_submissions.submitted_by_player_id -> players.id (RESTRICT).
  // If the user has no players, count stays 0 and we do not query this table.
  let matchScoreSubmissionsCount = 0
  if (playerIds.length > 0) {
    matchScoreSubmissionsCount = await countExact(admin, 'match_score_submissions', (q) => q.in('submitted_by_player_id', playerIds))
  }

  const blockReasons: string[] = []
  if (sessionsHostedCount > 0) {
    blockReasons.push(`此會員名下仍有 ${sessionsHostedCount} 筆場次（host_user_id），請先轉移或取消場次。`)
  }
  if (sessionsCreatedCount > 0) {
    blockReasons.push(`此會員仍為 ${sessionsCreatedCount} 筆場次的建立者（created_by_user_id），請先處理相關場次。`)
  }
  if (walletBalanceCents !== 0) {
    blockReasons.push('此會員錢包餘額不為 0，請先提領或調整至 0 後再刪除，避免帳務不一致。')
  }
  if (walletTransactionsCount > 0 || billingEventsCount > 0 || subscriptionsCount > 0 || paymentOrdersCount > 0) {
    blockReasons.push(
      '此會員已有帳務紀錄（儲值流水、帳務事件、訂閱或付款訂單），請改用停用／匿名化，避免破壞財務資料。'
    )
  }
  if (venuesOwnedCount > 0) {
    blockReasons.push(`此會員仍擁有 ${venuesOwnedCount} 個場館（venues），請先轉移或刪除場館。`)
  }
  if (pickupGroupsOwnedCount > 0) {
    blockReasons.push(`此會員仍擁有 ${pickupGroupsOwnedCount} 個臨打團設定（pickup_groups），請先轉移或刪除。`)
  }
  if (hostSessionRequestsCount > 0) {
    blockReasons.push(`此會員仍有 ${hostSessionRequestsCount} 筆 host_session_requests，請先處理。`)
  }

  const riskHints = [
    '永久刪除無法復原；將一併刪除推薦碼／球員／角色成員等關聯（不含帳務與場次）。',
    '若為正式會員或有帳務／場次，請勿刪除。',
  ]

  const canHardDelete = blockReasons.length === 0

  return {
    userId,
    email,
    displayName: profile?.display_name ?? null,
    primaryRole: profile?.primary_role ?? null,
    profileExists: Boolean(profile),
    playersCount,
    sessionsHostedCount,
    sessionsCreatedCount,
    sessionParticipantsCount,
    walletBalanceCents,
    walletTransactionsCount,
    billingEventsCount,
    referralLinksCount,
    subscriptionsCount,
    paymentOrdersCount,
    matchScoreSubmissionsCount,
    sessionWaitlistPromotionsCount,
    venuesOwnedCount,
    pickupGroupsOwnedCount,
    hostSessionRequestsCount,
    canHardDelete,
    blockReasons,
    riskHints,
  }
}
