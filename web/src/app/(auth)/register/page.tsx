'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from '../auth.module.css'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

    const { error: authError } = await supabase.auth.signUp({
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
    } else {
      router.push('/dashboard')
      router.refresh()
    }
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

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading}
        >
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
