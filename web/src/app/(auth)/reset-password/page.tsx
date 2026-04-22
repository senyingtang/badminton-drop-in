'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from '../auth.module.css'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession()
      setReady(true)
      if (!data.session) {
        setError('此頁面需要從重設密碼信件連結進入，或先完成驗證流程。')
      }
    })()
  }, [supabase])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (password.trim().length < 8) {
        throw new Error('密碼至少 8 碼')
      }
      const { error } = await supabase.auth.updateUser({ password: password.trim() })
      if (error) throw error
      alert('密碼已更新，請重新登入。')
      await supabase.auth.signOut()
      router.replace('/login')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失敗')
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
            placeholder="至少 8 碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            disabled={!ready}
          />
        </div>

        <button type="submit" className={styles.submitBtn} disabled={saving || !ready}>
          {saving && <span className={styles.spinner} />}
          {saving ? '更新中…' : '更新密碼'}
        </button>
      </form>

      <p className={styles.authFooter}>
        <Link href="/login">回到登入</Link>
      </p>
    </div>
  )
}

