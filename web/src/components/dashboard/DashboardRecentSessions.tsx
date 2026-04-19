'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import SessionCard from '@/components/sessions/SessionCard'
import styles from '@/app/(protected)/dashboard/dashboard.module.css'

const LIMIT = 8

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionRow = any

export default function DashboardRecentSessions() {
  const { user, loading: userLoading } = useUser()
  const supabase = createClient()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) {
      setSessions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('sessions')
      .select('*, venues(name), session_participants(count)')
      .eq('host_user_id', user.id)
      .order('start_at', { ascending: false })
      .limit(LIMIT)

    if (error) {
      console.error(error)
      setErr(error.message)
      setSessions([])
    } else {
      setSessions((data as SessionRow[]) || [])
    }
    setLoading(false)
  }, [user?.id, supabase])

  useEffect(() => {
    if (userLoading) return
    void load()
  }, [userLoading, load])

  if (userLoading || loading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>近期場次</h2>
        <p className={styles.opsHint}>載入中…</p>
      </section>
    )
  }

  if (err) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>近期場次</h2>
        <p className={styles.opsHint} style={{ color: 'var(--accent-red, #f87171)' }}>
          無法載入場次：{err}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
          重試
        </button>
      </section>
    )
  }

  if (sessions.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>近期場次</h2>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📋</span>
          <p className={styles.emptyTitle}>目前沒有由您主辦的場次</p>
          <p className={styles.emptyDesc}>此區僅列出您擔任團主（主辦）的場次；若場次由其他帳號建立，不會出現在此。</p>
          <Link href="/sessions/new" className="btn btn-ghost">
            建立場次
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <div className={styles.recentSessionsHeader}>
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
          近期場次
        </h2>
        <Link href="/sessions" className={styles.opsDetailLink}>
          場次管理 →
        </Link>
      </div>
      <div className={styles.recentSessionsGrid}>
        {sessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
    </section>
  )
}
