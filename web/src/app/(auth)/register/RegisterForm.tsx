'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
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

  const loginHref = useMemo(() => {
    const ref = searchParams.get('ref')
    if (!ref?.trim()) return '/login'
    const n = normalizeReferralCodeInput(ref)
    if (!isValidReferralCodeFormat(n)) return '/login'
    return `/login?ref=${encodeURIComponent(n)}`
  }, [searchParams])

  const lineRegisterUrl = useMemo(() => {
    const returnTo = encodeURIComponent('/dashboard')
    const base = `/api/auth/line/start?returnTo=${returnTo}`
    const ref = referralCode.trim() ? normalizeReferralCodeInput(referralCode) : ''
    if (ref && isValidReferralCodeFormat(ref)) {
      return `${base}&referralCode=${encodeURIComponent(ref)}`
    }
    return base
  }, [referralCode])

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

    // 提交當下合併「欄位」與「?ref=」：避免 useEffect 尚未寫入 state 就送出，導致 metadata 漏帶
    const refFromUrl = searchParams.get('ref')
    const fromField = referralCode.trim() ? normalizeReferralCodeInput(referralCode) : ''
    const fromUrl = refFromUrl?.trim() ? normalizeReferralCodeInput(refFromUrl) : ''
    const normRef = fromField || fromUrl

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

    const signUpData: Record<string, string> = {
      display_name: displayName,
    }
    if (normRef) {
      signUpData.pending_referral_code = normRef
    }

    if (process.env.NODE_ENV !== 'production') {
      console.info('[register] signUp user_metadata flags', {
        pending_referral_code: normRef ? 'will_set' : 'omit',
      })
    }

    const { error: authError, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: signUpData,
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (process.env.NODE_ENV !== 'production' && data.user) {
      const meta = data.user.user_metadata as Record<string, unknown> | undefined
      const pending = meta?.pending_referral_code
      console.info('[register] signUp response user_metadata', {
        has_pending_referral_code: typeof pending === 'string' && pending.length > 0,
        session_is_null: data.session == null,
      })
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

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          type="button"
          className={styles.submitBtn}
          onClick={() => {
            window.location.href = lineRegisterUrl
          }}
        >
          使用 LINE 建立帳號
        </button>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.5 }}>
          若上方已填寫有效推薦碼，將一併套用於 LINE 新帳（須為 8 碼格式正確）。
        </p>
      </div>

      <p className={styles.authFooter}>
        已有帳號？ <Link href={loginHref}>返回登入</Link>
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
