import type { SupabaseClient } from '@supabase/supabase-js'

function throwDb(ctx: string, err: { message: string } | null) {
  if (err) throw new Error(`${ctx}: ${err.message}`)
}

export async function hardDeleteUserPublicData(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: playerRows, error: pErr } = await admin.from('players').select('id').eq('auth_user_id', userId)
  throwDb('players(select)', pErr)
  const playerIds = (playerRows || []).map((r) => r.id as string)

  const { error: l1 } = await admin.from('member_referral_links').delete().or(`referrer_user_id.eq.${userId},referred_user_id.eq.${userId}`)
  throwDb('member_referral_links', l1)

  const { error: l2 } = await admin.from('member_referral_profiles').delete().eq('user_id', userId)
  throwDb('member_referral_profiles', l2)

  if (playerIds.length > 0) {
    const { error: l3 } = await admin.from('line_oa_binding_codes').delete().in('player_id', playerIds)
    throwDb('line_oa_binding_codes', l3)
  }

  const { error: l4 } = await admin.from('user_role_memberships').delete().eq('user_id', userId)
  throwDb('user_role_memberships', l4)

  const { error: l5 } = await admin.from('player_shared_notes').delete().eq('created_by_host_user_id', userId)
  throwDb('player_shared_notes', l5)

  const { error: l6 } = await admin.from('player_ratings').delete().eq('rated_by_host_user_id', userId)
  throwDb('player_ratings', l6)

  const { error: l7 } = await admin.from('session_waitlist_promotions').delete().eq('promoted_by_user_id', userId)
  throwDb('session_waitlist_promotions', l7)

  if (playerIds.length > 0) {
    const { error: l8 } = await admin.from('match_score_submissions').delete().in('player_id', playerIds)
    throwDb('match_score_submissions', l8)
  }

  if (playerIds.length > 0) {
    const { error: l9 } = await admin.from('session_participants').delete().in('player_id', playerIds)
    throwDb('session_participants', l9)
  }

  if (playerIds.length > 0) {
    const { error: l10 } = await admin
      .from('host_player_profiles')
      .delete()
      .or(`host_user_id.eq.${userId},player_id.in.(${playerIds.join(',')})`)
    throwDb('host_player_profiles', l10)
  } else {
    const { error: l10b } = await admin.from('host_player_profiles').delete().eq('host_user_id', userId)
    throwDb('host_player_profiles', l10b)
  }

  const { data: personalAccounts, error: baListErr } = await admin
    .from('kb_billing_accounts')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('account_type', 'personal')
  throwDb('kb_billing_accounts(select)', baListErr)

  for (const row of personalAccounts || []) {
    const baId = row.id as string
    const { error: wDel } = await admin.from('kb_wallets').delete().eq('billing_account_id', baId)
    throwDb('kb_wallets', wDel)
    const { error: baDel } = await admin.from('kb_billing_accounts').delete().eq('id', baId)
    throwDb('kb_billing_accounts', baDel)
  }

  const { error: l11 } = await admin.from('players').delete().eq('auth_user_id', userId)
  throwDb('players', l11)
}
