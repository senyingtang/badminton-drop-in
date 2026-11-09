'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { authErrorMessageZh, classifyAuthError, validateEmail } from '@/lib/auth/authPolicy'
import { authConfirmUrl, rememberPendingAuth } from '@/lib/auth/authNext'
import styles from '../auth.module.css'

function initialError(q: string | null): string | null {
  if (q === 'link_invalid') return authErrorMessageZh('link_invalid')
  if (q === 'other_device') return '重設連結必須在「申請重設的同一個瀏覽器」開啟。請在這裡重新申請，並用同一個瀏覽器打開信件。'
  return null
}

function ForgotPasswordInner() {
  const sp = useSearchParams()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(() => initialError(sp.get('error')))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const emailErr = validateEmail(email)
    if (emailErr) {
      setError(emailErr)
      return
    }
    setSending(true)
    try {
      const supabase = createClient()
      // 連結回到目前網域的 /auth/confirm（需列在 Supabase Redirect URLs）；完成後去 /reset-password
      rememberPendingAuth('recovery', '/reset-password')
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authConfirmUrl(window.location.origin),
      })
      if (error) {
        const code = classifyAuthError(error)
        // 只有「太頻繁 / 服務中斷」才提示錯誤；其他（含帳號不存在）一律顯示已寄出，避免帳號枚舉
        if (code === 'rate_limited' || code === 'auth_unavailable') {
          setError(authErrorMessageZh(code))
          return
        }
      }
      setSent(true)
    } catch {
      setError(authErrorMessageZh('auth_unavailable'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.authLogo}>🔐</div>
        <h1>忘記密碼</h1>
        <p>我們會寄出密碼重設連結到您的信箱。</p>
      </div>

      {error && <div className={styles.authError}>{error}</div>}
      {sent && (
        <div className={styles.authSuccess}>
          ✓ 若此 email 已註冊，我們已寄出重設連結。請用「這個瀏覽器」開啟信中的連結（1 小時內有效）。沒收到請檢查垃圾郵件。
        </div>
      )}

      <form className={styles.authForm} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label htmlFor="email">電子郵件</label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <button type="submit" className={styles.submitBtn} disabled={sending}>
          {sending && <span className={styles.spinner} />}
          {sending ? '發送中…' : '發送重設連結'}
        </button>
      </form>

      <p className={styles.authFooter}>
        <Link href="/login">回到登入</Link>
      </p>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className={styles.authCard}>載入中…</div>}>
      <ForgotPasswordInner />
    </Suspense>
  )
}
