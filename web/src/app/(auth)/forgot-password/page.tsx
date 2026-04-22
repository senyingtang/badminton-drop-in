'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from '../auth.module.css'

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    try {
      const origin = window.location.origin
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
      })
      if (error) throw error
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '發送失敗')
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
      {sent && <div className={styles.authSuccess}>✓ 已發送重設連結，請至信箱收信</div>}

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

