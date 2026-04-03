'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from '@/app/(protected)/settings/settings.module.css'

interface SecurityCardProps {
  userEmail: string | undefined
}

export default function SecurityCard({ userEmail }: SecurityCardProps) {
  const router = useRouter()
  const supabase = createClient()
  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleResetPassword = async () => {
    if (!userEmail) return
    setResetting(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: `${window.location.origin}/login?type=recovery`,
      })
      if (error) throw error
      setResetSent(true)
      setTimeout(() => setResetSent(false), 5000)
    } catch (error) {
      console.error('Error resetting password:', error)
      alert('發送密碼重設信件失敗，請稍後再試')
    } finally {
      setResetting(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>帳號安全</h2>
        <p className={styles.cardDesc}>管理您的密碼與登入狀態。</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-secondary)' }}>重設密碼</h3>
            <p className={styles.cardDesc}>系統將發送一封包含密碼重設連結的信件至您的信箱。</p>
          </div>
          <button 
            type="button" 
            className={styles.btnPrimary} 
            onClick={handleResetPassword}
            disabled={resetting || resetSent}
            style={{ minWidth: '140px' }}
          >
            {resetSent ? '✓ 信件已發送' : resetting ? '發送中...' : '發送重設信件'}
          </button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-secondary)' }}>登出帳號</h3>
            <p className={styles.cardDesc}>在目前的裝置上登出您的羽球排組帳號。</p>
          </div>
          <button 
            type="button" 
            className={styles.btnDanger} 
            onClick={handleSignOut}
          >
            登出
          </button>
        </div>
      </div>
    </div>
  )
}
