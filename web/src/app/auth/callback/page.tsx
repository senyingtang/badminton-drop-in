'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function safeNext(raw: string | null): string {
  const v = (raw || '').trim()
  if (!v) return '/dashboard'
  if (!v.startsWith('/')) return '/dashboard'
  if (v.startsWith('//')) return '/dashboard'
  if (v.includes('\\')) return '/dashboard'
  return v
}

function AuthCallbackInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const supabase = createClient()
  const [msg, setMsg] = useState('處理登入中…')

  useEffect(() => {
    void (async () => {
      const next = safeNext(sp.get('next'))

      // 1) magiclink / action_link 會把 token 放在 URL hash（伺服端看不到）
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      const hp = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
      const access_token = hp.get('access_token')
      const refresh_token = hp.get('refresh_token')

      try {
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (error) throw error
          setMsg('登入成功，正在跳轉…')
          router.replace(next)
          router.refresh()
          return
        }

        // 2) PKCE code flow（若有）
        const code = sp.get('code')
        if (code) {
          // 讓 supabase-js 自己處理 exchange（瀏覽器端可用）
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
          setMsg('登入成功，正在跳轉…')
          router.replace(next)
          router.refresh()
          return
        }

        setMsg('登入資訊不足，請重新登入。')
        router.replace(`/login?error=auth_callback_failed&returnTo=${encodeURIComponent(next)}`)
      } catch (e) {
        const m = e instanceof Error ? e.message : 'auth_callback_failed'
        setMsg('登入失敗，將帶您回登入頁…')
        router.replace(`/login?error=${encodeURIComponent(m)}&returnTo=${encodeURIComponent(next)}`)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
      <div style={{ textAlign: 'center', lineHeight: 1.8 }}>
        <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>🔐</div>
        <div>{msg}</div>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ textAlign: 'center', lineHeight: 1.8 }}>處理登入中…</div>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  )
}

