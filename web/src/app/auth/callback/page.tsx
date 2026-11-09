'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { isSafeInternalReturnPath } from '@/lib/safeInternalReturnPath'
import { decideAuthCallback } from '@/lib/auth/authCallback'
import { takePendingAuth } from '@/lib/auth/authNext'

/**
 * Email 驗證 / 重設密碼 / LINE 登入（magiclink）的回跳頁。也作為 /auth/confirm。
 * 支援三種回跳格式：
 *   1. ?token_hash=…&type=signup|recovery|magiclink|email|invite|email_change
 *      （建議的 Email 範本格式；不需要 PKCE verifier，可在其他裝置 / 瀏覽器開啟）
 *   2. ?code=…（PKCE；需同一瀏覽器）
 *   3. #access_token=…&refresh_token=…（implicit / LINE magiclink）
 * 也處理 Supabase 回傳的錯誤（?error=… 或 #error=…，例如連結過期 otp_expired、已使用過）。
 * 驗證在瀏覽器 JS 內進行：郵件掃毒程式預先 GET 連結不會把一次性 token 用掉。
 */
function AuthCallbackInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const [msg, setMsg] = useState('處理登入中…')

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      const hp = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
      const type = (sp.get('type') || hp.get('type') || '').toLowerCase()
      const rawNext = sp.get('next')
      // Email 驗證 / 重設密碼送出時記在本機的去處（同一瀏覽器才讀得到；LINE magic link 走網址 next）
      const pending = hp.get('access_token') ? null : takePendingAuth()
      const isRecovery = type === 'recovery' || (!type && pending?.kind === 'recovery')
      const next = isRecovery
        ? '/reset-password'
        : isSafeInternalReturnPath(rawNext)
          ? (rawNext as string).trim()
          : pending?.kind === 'signup'
            ? pending.next
            : '/dashboard'
      // 立刻清掉網址中的 token（避免留在瀏覽紀錄、被分享或被第三方腳本讀到）
      try {
        window.history.replaceState(null, '', window.location.pathname)
      } catch {
        /* ignore */
      }

      const go = (path: string, text: string) => {
        setMsg(text)
        router.replace(path)
        router.refresh()
      }

      const errorCode = sp.get('error_code') || hp.get('error_code') || sp.get('error') || hp.get('error')
      const tokenHash = sp.get('token_hash')
      const code = sp.get('code')
      const accessToken = hp.get('access_token')
      const refreshToken = hp.get('refresh_token')

      let outcome: { ok: true } | { ok: false; error: { code?: string; name?: string; message?: string } } | null = null
      try {
        if (!errorCode) {
          if (tokenHash && type) {
            const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
            outcome = error ? { ok: false, error } : { ok: true }
          } else if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
            outcome = error ? { ok: false, error } : { ok: true }
          } else if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code)
            outcome = error ? { ok: false, error } : { ok: true }
          }
        }
      } catch (e) {
        outcome = { ok: false, error: e as Error }
      }

      // 失敗時若其實已有有效 session（例如重複點擊同一個連結），直接放行
      let hasSession = false
      if (!outcome || !outcome.ok) {
        try {
          const { data } = await supabase.auth.getSession()
          hasSession = !!data.session
        } catch {
          hasSession = false
        }
      }

      const d = decideAuthCallback({
        type: isRecovery ? 'recovery' : type,
        next,
        providerError: errorCode,
        attempted: outcome !== null,
        success: outcome?.ok === true,
        error: outcome && !outcome.ok ? outcome.error : null,
        hasSession,
      })
      go(d.redirect, d.message)
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
