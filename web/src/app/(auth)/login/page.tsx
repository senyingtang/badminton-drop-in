'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import styles from '../auth.module.css'

function humanizeError(code: string): string {
  const c = (code || '').trim()
  if (!c) return '登入失敗'
  if (c.startsWith('referral_profile_failed:')) {
    return '登入設定未完成（推薦資料庫尚未更新），請聯絡管理員或稍後再試。'
  }
  if (c.startsWith('line_oauth_error:')) return `LINE 授權失敗：${c.slice('line_oauth_error:'.length)}`
  switch (c) {
    case 'line_invalid_state':
      return 'LINE 登入驗證失敗（state 不一致），請重試。'
    case 'missing_login_channel':
      return 'LINE Login 尚未設定（缺少 channel id/secret）。'
    case 'token_exchange_failed':
      return 'LINE 登入失敗（token 交換失敗），請稍後重試。'
    case 'missing_sub':
      return 'LINE 登入失敗（缺少使用者識別）。'
    case 'nonce_mismatch':
      return 'LINE 登入驗證失敗（nonce 不一致），請重試。'
    case 'line_user_create_failed_email_exists':
      return '此 email 已存在，系統已嘗試重用既有帳號但失敗，請改用原本方式登入後再綁定，或檢查 LINE email scope。'
    case 'line_generate_link_failed':
      return '登入連結產生失敗，請稍後重試。'
    case 'service_role_not_configured':
      return '伺服端登入服務未設定（缺少 service role）。'
    case 'auth_callback_failed':
      return '登入回跳失敗，請重試。'
    default:
      return decodeURIComponent(c)
  }
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(() => {
    const q = searchParams.get('error')
    return q ? humanizeError(q) : null
  })
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [lineReferralCode, setLineReferralCode] = useState('')

  const safeReturnTo = () => {
    const raw = searchParams.get('returnTo')
    return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/dashboard'
  }

  const handleLineLogin = async () => {
    setOauthLoading(true)
    setError(null)
    try {
      const ref = lineReferralCode.trim()
      const refQ =
        ref.length > 0
          ? `&referralCode=${encodeURIComponent(ref.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/gi, ''))}`
          : ''
      window.location.href = `/api/auth/line/start?returnTo=${encodeURIComponent(safeReturnTo())}${refQ}`
    } catch (e) {
      setError(e instanceof Error ? e.message : '跳轉失敗')
      setOauthLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/password-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) {
        setError(j?.error || '登入失敗')
        setLoading(false)
        return
      }
      router.push(safeReturnTo())
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '登入失敗')
      setLoading(false)
    }
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.authLogo}>🏸</div>
        <h1>歡迎回來</h1>
        <p>登入您的羽球排組管理帳號</p>
      </div>

      {error && <div className={styles.authError}>{error}</div>}

      <form className={styles.authForm} onSubmit={handleLogin}>
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

        <div className={styles.field}>
          <label htmlFor="password">密碼</label>
          <input
            id="password"
            type="password"
            placeholder="輸入密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading}
        >
          {loading && <span className={styles.spinner} />}
          {loading ? '登入中...' : '登入'}
        </button>
      </form>

      <div className={styles.field} style={{ marginTop: 6 }}>
        <label htmlFor="lineReferral">推薦碼（選填，僅 LINE 註冊／新帳）</label>
        <input
          id="lineReferral"
          type="text"
          placeholder="8 碼英數"
          value={lineReferralCode}
          onChange={(e) => setLineReferralCode(e.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '').slice(0, 8))}
          maxLength={8}
          autoComplete="off"
        />
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" className={styles.submitBtn} onClick={() => void handleLineLogin()} disabled={oauthLoading}>
          {oauthLoading && <span className={styles.spinner} />}
          {oauthLoading ? '跳轉至 LINE…' : '使用 LINE 登入'}
        </button>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.5 }}>
          使用 LINE 登入後，系統可將您的帳號與球員資料對應，並支援名單異動推播通知。
        </p>
      </div>

      <p className={styles.authFooter}>
        <Link href="/forgot-password">忘記密碼</Link>
        {' · '}
        還沒有帳號？{' '}
        <Link href={lineReferralCode.trim() ? `/register?ref=${encodeURIComponent(lineReferralCode.trim())}` : '/register'}>
          立即註冊
        </Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.authCard}>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>載入中…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
