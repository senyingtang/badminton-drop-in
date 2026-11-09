'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { authErrorMessageZh, classifyAuthError, PASSWORD_MIN, validatePassword } from '@/lib/auth/authPolicy'
import styles from '../auth.module.css'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [noSession, setNoSession] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession()
      setReady(true)
      if (!data.session) {
        setNoSession(true)
        setError('重設連結已失效或尚未驗證。請從「忘記密碼」重新申請，並在同一個瀏覽器開啟信中的連結。')
      }
    })()
  }, [supabase])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const pwErr = validatePassword(password)
      if (pwErr) {
        setError(pwErr)
        return
      }
      if (password !== confirm) {
        setError('兩次輸入的密碼不一致')
        return
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        const code = classifyAuthError(error)
        setError(authErrorMessageZh(code))
        if (code === 'session_missing') setNoSession(true)
        return
      }
      // 改密碼後登出所有裝置的舊 session（其他裝置的 refresh token 失效），再用新密碼登入
      await supabase.auth.signOut({ scope: 'global' }).catch(() => supabase.auth.signOut({ scope: 'local' }))
      // 整頁導向：避免 client router 沿用「登入中」時預取的 /login 結果（會被導回會員頁）
      window.location.assign('/login?reason=password_updated')
    } catch {
      setError(authErrorMessageZh('auth_unavailable'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.authLogo}>🔐</div>
        <h1>重設密碼</h1>
        <p>請輸入新密碼。</p>
      </div>

      {error && <div className={styles.authError}>{error}</div>}

      <form className={styles.authForm} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label htmlFor="password">新密碼</label>
          <input
            id="password"
            type="password"
            placeholder={`至少 ${PASSWORD_MIN} 碼，含英文字母與數字`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            disabled={!ready || noSession}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="confirm">確認新密碼</label>
          <input
            id="confirm"
            type="password"
            placeholder="再次輸入新密碼"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            disabled={!ready || noSession}
          />
        </div>

        <button type="submit" className={styles.submitBtn} disabled={saving || !ready || noSession}>
          {saving && <span className={styles.spinner} />}
          {saving ? '更新中…' : '更新密碼'}
        </button>
      </form>

      <p className={styles.authFooter}>
        <Link href="/forgot-password">重新申請重設連結</Link>
        {' · '}
        <Link href="/login">回到登入</Link>
      </p>
    </div>
  )
}

