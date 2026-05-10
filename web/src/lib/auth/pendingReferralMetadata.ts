import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 將 pending_referral_code 標為 null（Auth user_metadata 為 merge；null 可覆寫既有字串）。
 * useProfileSync 僅處理 typeof === 'string' 且非空之值。
 */
export async function clearPendingReferralCodeFromAuthUser(
  admin: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error: upErr } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { pending_referral_code: null },
  })
  if (upErr) return { ok: false, error: upErr.message }
  return { ok: true }
}
