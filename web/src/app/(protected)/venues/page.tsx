'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './venues.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VenueRow = any

export default function VenuesPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [venues, setVenues] = useState<VenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const fetchVenues = useCallback(async () => {
    if (!user) {
      setVenues([])
      setListError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setListError(null)
    const { data, error } = await supabase
      .from('venues')
      .select('*, courts(id)')
      .eq('owner_user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('fetchVenues', error)
      setListError(error.message)
      setVenues([])
    } else {
      setVenues(data || [])
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    void fetchVenues()
  }, [fetchVenues])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchVenues()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [fetchVenues])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>場館管理</h1>
          <p className={styles.subtitle}>查看您所擁有的場館，並管理球場細節</p>
        </div>
        <Link href="/venues/new" className="btn btn-primary">
          ＋ 新增場館
        </Link>
      </div>

      {listError && (
        <div className={styles.listError} role="alert">
          <p>
            <strong>無法載入場館列表</strong>（與手機／電腦無關，多為連線或權限問題）：{listError}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void fetchVenues()}>
            重新載入
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>載入場館中...</p>
        </div>
      ) : listError ? null : venues.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📍</span>
          <p className={styles.emptyTitle}>尚無管理的場館</p>
          <p className={styles.emptyDesc}>您可以建立一個新的場地並設定球場數量。</p>
          <Link href="/venues/new" className="btn btn-primary">
            立即建立
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {venues.map((v) => (
            <Link key={v.id} href={`/venues/${v.id}`} className={styles.card}>
              <h3 className={styles.cardTitle}>{v.name}</h3>
              <div className={styles.cardMeta}>
                <span>📍 {v.city}{v.district}{v.address_text}</span>
              </div>
              <div className={styles.cardInfo}>
                <span className={styles.courtBadge}>
                  場地數 {v.courts?.length || 0} 面
                </span>
                <span>點擊編輯 →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
