'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './new-venue.module.css'

export default function NewVenuePage() {
  const router = useRouter()
  const { user } = useUser()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      const { data, error: err } = await supabase
        .from('venues')
        .insert({
          name: name.trim(),
          owner_user_id: user.id,
        })
        .select('id')
        .single()

      if (err) throw err
      router.push(`/venues/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗')
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/venues" className={styles.backLink}>← 返回</Link>
        <h1 className={styles.title}>建立新場館</h1>
      </div>

      <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label>場館名稱 *</label>
            <input 
              type="text" 
              className="input" 
              placeholder="例：大安運動中心"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '建立中...' : '下一步：配置球場'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
