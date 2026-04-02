'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

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
          primary_role: 'host',
        })

        await supabase.from('user_role_memberships').insert({
          user_id: user.id,
          role: 'host',
        })
      }
    }

    syncProfile().catch(console.error)
  }, [user, supabase])
}
