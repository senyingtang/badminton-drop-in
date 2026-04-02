'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import SessionCard from '@/components/sessions/SessionCard'
import styles from './sessions.module.css'

type StatusFilter = 'all' | 'active' | 'finished' | 'cancelled'

const filterTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '進行中' },
  { key: 'finished', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
]

const activeStatuses = ['draft', 'pending_confirmation', 'ready_for_assignment', 'assigned', 'in_progress', 'round_finished']
const finishedStatuses = ['session_finished']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionRow = any

export default function SessionsPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    if (!user) return

    const fetchSessions = async () => {
      setLoading(true)
      let query = supabase
        .from('sessions')
        .select('*, venues(name), session_participants(count)')
        .eq('host_user_id', user.id)
        .order('start_at', { ascending: false })

      if (filter === 'active') {
        query = query.in('status', activeStatuses)
      } else if (filter === 'finished') {
        query = query.in('status', finishedStatuses)
      } else if (filter === 'cancelled') {
        query = query.eq('status', 'cancelled')
      }

      const { data } = await query
      setSessions(data || [])
      setLoading(false)
    }

    fetchSessions()
  }, [user, filter, supabase])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>場次管理</h1>
          <p className={styles.subtitle}>管理您的羽球場次、報名與排組</p>
        </div>
        <Link href="/sessions/new" className="btn btn-primary">
          ＋ 建立場次
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className={styles.tabs}>
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.tab} ${filter === tab.key ? styles.tabActive : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>載入場次中...</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🏸</span>
          <p className={styles.emptyTitle}>
            {filter === 'all' ? '尚無場次' : `沒有${filterTabs.find(t => t.key === filter)?.label}的場次`}
          </p>
          <p className={styles.emptyDesc}>開始建立您的第一個羽球場次！</p>
          <Link href="/sessions/new" className="btn btn-primary">
            建立場次
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {sessions.map((session: SessionRow) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}
