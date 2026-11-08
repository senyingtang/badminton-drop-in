'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'
import { authErrorMessageZh, classifyAuthError, PASSWORD_MIN, validateEmail, validatePassword } from '@/lib/auth/authPolicy'
import { isSafeInternalReturnPath } from '@/lib/safeInternalReturnPath'
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
  /** 註冊已送出、需要到信箱點驗證連結（重複 email 也顯示同一畫面，不透露帳號是否存在） */
  const [sentTo, setSentTo] = useState<string | null>(null)

  const returnTo = useMemo(() => {
    const rt = searchParams.get('returnTo')
    return isSafeInternalReturnPath(rt) && !/^\/(login|register)(\/|\?|$)/.test(rt as string) ? (rt as string).trim() : '/dashboard'
  }, [searchParams])

  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref && ref.trim()) {
      setReferralCode(normalizeReferralCodeInput(ref))
    }
  }, [searchParams])

  const loginHref = useMemo(() => {
    const q = new URLSearchParams()
    const ref = searchParams.get('ref')
    if (ref?.trim()) {
      const n = normalizeReferralCodeInput(ref)
      if (isValidReferralCodeFormat(n)) q.set('ref', n)
    }
    if (returnTo !== '/dashboard') q.set('returnTo', returnTo)
    const qs = q.toString()
    return qs ? `/login?${qs}` : '/login'
  }, [searchParams, returnTo])

  const lineRegisterUrl = useMemo(() => {
    const base = `/api/auth/line/start?returnTo=${encodeURIComponent(returnTo)}`
    const ref = referralCode.trim() ? normalizeReferralCodeInput(referralCode) : ''
    if (ref && isValidReferralCodeFormat(ref)) {
      return `${base}&referralCode=${encodeURIComponent(ref)}`
    }
    return base
  }, [referralCode, returnTo])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError('密碼與確認密碼不一致')
      setLoading(false)
      return
    }

    const emailErr = validateEmail(email)
    if (emailErr) {
      setError(emailErr)
      setLoading(false)
      return
    }
    const pwErr = validatePassword(password)
    if (pwErr) {
      setError(pwErr)
      setLoading(false)
      return
    }
    if (!displayName.trim()) {
      setError('請輸入顯示名稱')
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
      display_name: displayName.trim().slice(0, 50),
    }
    if (normRef) {
      signUpData.pending_referral_code = normRef
    }

    if (process.env.NODE_ENV !== 'production') {
      console.info('[register] signUp user_metadata flags', {
        pending_referral_code: normRef ? 'will_set' : 'omit',
      })
    }

    // 驗證信的連結回到「目前這個網域」（Cloudflare / Vercel / 本機各自正確），不再落到 Supabase Site URL。
    // 網址必須列在 Supabase Auth → URL Configuration → Redirect URLs，否則 Supabase 會改用 Site URL。
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`
    const cleanEmail = email.trim()
    const { error: authError, data } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: signUpData,
        emailRedirectTo,
      },
    })

    if (authError) {
      const code = classifyAuthError(authError)
      // user_already_exists 等：與成功同一畫面，避免帳號枚舉
      if (code === 'unknown' && /already|registered|exists/i.test(authError.message || '')) {
        setSentTo(cleanEmail)
        setLoading(false)
        return
      }
      setError(authErrorMessageZh(code === 'unknown' ? 'unknown' : code))
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
    if (!session) {
      // 需要信箱驗證（Confirm email 開啟），或 email 已註冊（Supabase 回傳無 identities 的假使用者）。
      // 兩者顯示同一訊息，不透露帳號是否存在。推薦碼已存在 user_metadata，驗證後登入時由既有流程套用。
      setSentTo(cleanEmail)
      setLoading(false)
      return
    }
    {
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
        setError('註冊後處理推薦資料失敗，請稍後再試或聯絡客服。')
        setLoading(false)
        return
      }
    }

    router.push(returnTo)
    router.refresh()
  }

  if (sentTo) {
    return (
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <div className={styles.authLogo}>📧</div>
          <h1>請前往信箱驗證</h1>
          <p>
            如果 <strong>{sentTo}</strong> 可以註冊，我們已寄出驗證信。請在 24 小時內點擊信中的連結完成驗證，再回來登入。
          </p>
        </div>
        <ul style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          <li>沒收到？請檢查垃圾郵件 / 促銷內容匣，幾分鐘後再試。</li>
          <li>這個 email 若之前已註冊過，請直接登入或使用「忘記密碼」。</li>
          <li>可以在其他裝置（例如電腦）開啟驗證信，驗證完成後回到本頁登入即可。</li>
        </ul>
        <p className={styles.authFooter}>
          <Link href={loginHref}>前往登入</Link>
          {' · '}
          <Link href="/forgot-password">忘記密碼</Link>
        </p>
      </div>
    )
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
            placeholder={`至少 ${PASSWORD_MIN} 個字元，含英文字母與數字`}
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
