'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from '../auth.module.css'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  const safeReturnTo = () => {
    const raw = searchParams.get('returnTo')
    return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/dashboard'
  }

  const handleLineLogin = async () => {
    setOauthLoading(true)
    setError(null)
    try {
      window.location.href = `/api/auth/line/start?returnTo=${encodeURIComponent(safeReturnTo())}`
    } catch (e) {
      setError(e instanceof Error ? e.message : '跳轉失敗')
      setOauthLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      router.push(safeReturnTo())
      router.refresh()
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
        還沒有帳號？ <Link href="/register">立即註冊</Link>
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
