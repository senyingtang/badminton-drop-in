'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from '@/app/(protected)/settings/settings.module.css'

interface ProfileFormProps {
  user: any
}

export default function ProfileForm({ user }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    // Fetch current profile
    async function fetchProfile() {
      const { data } = await supabase
        .from('app_user_profiles')
        .select('display_name')
        .eq('id', user.id)
        .single()
      
      if (data && data.display_name) {
        setDisplayName(data.display_name)
      }
    }
    fetchProfile()
  }, [user.id, supabase])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setSuccess(false)

    try {
      const { error } = await supabase
        .from('app_user_profiles')
        .update({ display_name: displayName })
        .eq('id', user.id)

      if (error) throw error
      setSuccess(true)
      
      // Auto-hide success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (error) {
      console.error('Error updating profile:', error)
      alert('更新失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleUpdate} className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>個人資料</h2>
        <p className={styles.cardDesc}>管理您在平台上的公開資訊與聯絡方式。</p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="email" className={styles.label}>電子郵件 (登入帳號)</label>
        <input 
          id="email"
          type="email" 
          value={user.email || ''} 
          disabled 
          className={styles.input} 
        />
        <p className={styles.cardDesc} style={{ fontSize: '0.75rem', marginTop: '-4px' }}>
          * 若需更改電子郵件，請依循密碼重置流程或聯絡客服。
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="displayName" className={styles.label}>顯示名稱 (Display Name)</label>
        <input 
          id="displayName"
          type="text" 
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例如：熱血羽球員"
          className={styles.input} 
          required
          maxLength={30}
        />
      </div>

      <div className={styles.actions}>
        {success && (
          <span className={styles.successMessage}>
            <span>✓</span> 更新成功
          </span>
        )}
        <button 
          type="submit" 
          className={styles.btnPrimary}
          disabled={loading || !displayName.trim()}
        >
          {loading ? '儲存中...' : '儲存變更'}
        </button>
      </div>
    </form>
  )
}
