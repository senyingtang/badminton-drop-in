'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'
import type { User } from '@supabase/supabase-js'

async function clearPendingReferralClient() {
  await fetch('/api/auth/clear-pending-referral', { method: 'POST', credentials: 'include' })
}

export function useProfileSync(user: User | null) {
  const synced = useRef(false)
  const supabase = createClient()

  useEffect(() => {
    if (!user || synced.current) return
    synced.current = true

    const syncProfile = async () => {
      const { data } = await supabase
        .from('app_user_profiles')
        .select('id')
        .eq('id', user.id)
        .single()

      if (!data) {
        const displayName =
          user.user_metadata?.display_name ||
          user.email?.split('@')[0] ||
          'User'

        await supabase.from('app_user_profiles').insert({
          id: user.id,
          display_name: displayName,
          primary_role: 'player',
        })

        await supabase.from('user_role_memberships').insert({
          user_id: user.id,
          role: 'player',
        })
      }

      const { error: refErr } = await supabase.rpc('ensure_member_referral_profile', { p_user_id: user.id })
      if (refErr) {
        console.error('ensure_member_referral_profile', refErr)
      }

      const pendingRaw = user.user_metadata?.pending_referral_code
      if (typeof pendingRaw === 'string' && pendingRaw.trim()) {
        const norm = normalizeReferralCodeInput(pendingRaw)
        if (!isValidReferralCodeFormat(norm)) {
          console.warn('[referral] pending_referral_code invalid format, clearing', norm)
          await clearPendingReferralClient()
        } else {
          const { error: linkErr } = await supabase.rpc('member_referral_try_link_after_signup', {
            p_referred_user_id: user.id,
            p_referral_code: norm,
          })
          if (linkErr) {
            const msg = linkErr.message || ''
            if (/invalid_referral|self_referral|22023/i.test(msg)) {
              console.warn('[referral] pending link skipped:', msg)
              await clearPendingReferralClient()
            } else {
              console.warn('[referral] pending link deferred (transient):', msg)
            }
          } else {
            await clearPendingReferralClient()
          }
        }
      }
    }

    syncProfile().catch(console.error)
  }, [user, supabase])
}
