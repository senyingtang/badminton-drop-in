'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './QuotaCard.module.css'

interface QuotaData {
  tier_name: string
  sessions_used: number
  sessions_limit: number
  players_used: number
  players_limit: number
  period_start: string
  period_end: string
}

export default function QuotaCard() {
  const [quota, setQuota] = useState<QuotaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('kb_get_quota_dashboard')

        if (rpcError) {
          // If RPC doesn't exist yet, show graceful fallback
          setError('配額資料暫時無法載入')
          setLoading(false)
          return
        }

        if (data && data.length > 0) {
          setQuota(data[0])
        } else if (data) {
          setQuota(data)
        }
      } catch {
        setError('配額資料暫時無法載入')
      } finally {
        setLoading(false)
      }
    }

    fetchQuota()
  }, [supabase])

  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.skeleton}>
          <div className={styles.skeletonLine} style={{ width: '40%' }} />
          <div className={styles.skeletonLine} style={{ width: '80%' }} />
          <div className={styles.skeletonLine} style={{ width: '60%' }} />
        </div>
      </div>
    )
  }

  if (error || !quota) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}>📊</span>
          <h3 className={styles.cardTitle}>方案配額</h3>
        </div>
        <div className={styles.fallback}>
          <p className={styles.fallbackText}>{error || '尚未設定訂閱方案'}</p>
          <p className={styles.fallbackHint}>請聯繫管理員設定您的方案</p>
        </div>
      </div>
    )
  }

  const sessionPercent = quota.sessions_limit > 0
    ? Math.min((quota.sessions_used / quota.sessions_limit) * 100, 100)
    : 0
  const playerPercent = quota.players_limit > 0
    ? Math.min((quota.players_used / quota.players_limit) * 100, 100)
    : 0

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.cardIcon}>📊</span>
          <h3 className={styles.cardTitle}>方案配額</h3>
        </div>
        <span className={`badge badge-purple`}>{quota.tier_name}</span>
      </div>

      <div className={styles.meters}>
        {/* Sessions */}
        <div className={styles.meter}>
          <div className={styles.meterHeader}>
            <span className={styles.meterLabel}>場次用量</span>
            <span className={styles.meterValue}>
              <strong>{quota.sessions_used}</strong>
              <span className={styles.meterDivider}>/</span>
              {quota.sessions_limit}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <div
              className={`${styles.progressBar} ${sessionPercent > 80 ? styles.warning : ''}`}
              style={{ width: `${sessionPercent}%` }}
            />
          </div>
        </div>

        {/* Players */}
        <div className={styles.meter}>
          <div className={styles.meterHeader}>
            <span className={styles.meterLabel}>球員名額</span>
            <span className={styles.meterValue}>
              <strong>{quota.players_used}</strong>
              <span className={styles.meterDivider}>/</span>
              {quota.players_limit}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <div
              className={`${styles.progressBar} ${playerPercent > 80 ? styles.warning : ''}`}
              style={{ width: `${playerPercent}%` }}
            />
          </div>
        </div>
      </div>

      {quota.period_end && (
        <p className={styles.periodHint}>
          計費週期結束：{new Date(quota.period_end).toLocaleDateString('zh-TW')}
        </p>
      )}
    </div>
  )
}
