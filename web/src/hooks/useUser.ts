'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

/** 用戶端等待 Supabase Auth 的上限，避免畫面永遠停在「載入中」 */
const AUTH_CHECK_TIMEOUT_MS = 8000

export type UserCheckError = 'timeout' | null

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<UserCheckError>(null)
  const supabase = createClient()

  useEffect(() => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // 逾時：不視為已登入（fail-closed），但也不自動導向，交由畫面提供重試
      setUser(null)
      setError('timeout')
      setLoading(false)
    }, AUTH_CHECK_TIMEOUT_MS)

    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (settled) return
      settled = true
      clearTimeout(timer)
      setUser(user)
      setError(null)
      setLoading(false)
    }

    getUser().catch(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      setUser(null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        settled = true
        clearTimeout(timer)
        setUser(session?.user ?? null)
        setError(null)
        setLoading(false)
      }
    )

    return () => {
      clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [supabase])

  return { user, loading, error }
}
