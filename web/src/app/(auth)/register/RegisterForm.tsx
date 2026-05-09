'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'
import styles from '../auth.module.css'

function RegisterFormInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref && ref.trim()) {
      setReferralCode(normalizeReferralCodeInput(ref))
    }
  }, [searchParams])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError('密碼與確認密碼不一致')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('密碼長度至少需要 6 個字元')
      setLoading(false)
      return
    }

    const normRef = referralCode.trim() ? normalizeReferralCodeInput(referralCode) : ''

    if (normRef) {
      if (!isValidReferralCodeFormat(normRef)) {
        setError('推薦碼格式不正確（須為 8 碼英數，不含 0/O/1/I）')
        setLoading(false)
        return
      }
      const vr = await fetch(`/api/auth/validate-referral-code?code=${encodeURIComponent(normRef)}`, {
        credentials: 'include',
      })
      const vj = (await vr.json().catch(() => null)) as { ok?: boolean; valid?: boolean } | null
      if (!vr.ok || !vj?.ok || !vj.valid) {
        setError('推薦碼不存在或已失效')
        setLoading(false)
        return
      }
    }

    const { error: authError, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    const session = data.session
    if (session) {
      const pr = await fetch('/api/auth/post-signup-referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ referralCode: normRef || null }),
      })
      const pj = (await pr.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!pr.ok || !pj?.ok) {
        if (pj?.error === 'INVALID_REFERRAL' || pj?.error === 'INVALID_REFERRAL_FORMAT') {
          setError('推薦碼不存在或已失效')
          setLoading(false)
          return
        }
        setError(pj?.error || '註冊後處理推薦資料失敗，請稍後再試或聯絡客服。')
        setLoading(false)
        return
      }
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.authLogo}>🏸</div>
        <h1>建立帳號</h1>
        <p>開始使用羽球排組管理平台</p>
      </div>

      {error && <div className={styles.authError}>{error}</div>}

      <form className={styles.authForm} onSubmit={handleRegister}>
        <div className={styles.field}>
          <label htmlFor="displayName">顯示名稱</label>
          <input
            id="displayName"
            type="text"
            placeholder="您的名稱"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>

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
            placeholder="至少 6 個字元"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="confirmPassword">確認密碼</label>
          <input
            id="confirmPassword"
            type="password"
            placeholder="再次輸入密碼"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="referralCode">推薦碼（選填）</label>
          <input
            id="referralCode"
            type="text"
            placeholder="8 碼英數，不含 0/O/1/I"
            value={referralCode}
            onChange={(e) => setReferralCode(normalizeReferralCodeInput(e.target.value))}
            maxLength={8}
            autoComplete="off"
          />
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            註冊完成後無法於前台補填；註冊後即永久綁定推薦關係。
          </p>
        </div>

        <button type="submit" className={styles.submitBtn} disabled={loading}>
          {loading && <span className={styles.spinner} />}
          {loading ? '註冊中...' : '建立帳號'}
        </button>
      </form>

      <p className={styles.authFooter}>
        已有帳號？ <Link href="/login">返回登入</Link>
      </p>
    </div>
  )
}

export default function RegisterForm() {
  return (
    <Suspense
      fallback={
        <div className={styles.authCard}>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>載入中…</p>
        </div>
      }
    >
      <RegisterFormInner />
    </Suspense>
  )
}
