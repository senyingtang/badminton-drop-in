'use client'

import { use, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import EditSessionForm from '@/components/sessions/EditSessionForm'
import styles from '../session-detail.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionRow = any

export default function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const { user, loading: authLoading } = useUser()
  const supabase = createClient()
  const [session, setSession] = useState<SessionRow | null>(undefined)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoadErr(null)
    const { data, error } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle()
    if (error) {
      setLoadErr(error.message)
      setSession(null)
      return
    }
    if (!data || data.host_user_id !== user.id) {
      setSession(null)
      return
    }
    if (['session_finished', 'cancelled'].includes(String(data.status))) {
      setSession(null)
      return
    }
    setSession(data)
  }, [sessionId, supabase, user])

  useEffect(() => {
    if (!authLoading && user) void load()
  }, [authLoading, user, load])

  if (authLoading || session === undefined) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入中...</p>
      </div>
    )
  }

  if (loadErr) {
    return (
      <div className={styles.notFound}>
        <p>載入失敗：{loadErr}</p>
        <Link href={`/sessions/${sessionId}`} className="btn btn-ghost">
          返回場次
        </Link>
      </div>
    )
  }

  if (!session) {
    return (
      <div className={styles.notFound}>
        <p>無法編輯：僅主辦本人可編輯，且場次須為「草稿、報名中、待排組、已排組、開打中、輪次結束」狀態。</p>
        <Link href={`/sessions/${sessionId}`} className="btn btn-ghost">
          返回場次
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/sessions" className={styles.breadcrumbLink}>
          場次管理
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href={`/sessions/${sessionId}`} className={styles.breadcrumbLink}>
          {session.title}
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>編輯</span>
      </div>
      <h1 className={styles.infoTitle} style={{ marginBottom: '1rem' }}>
        編輯場次
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: 'var(--text-sm)' }}>
        可調整時間、場館、場地數、用球、報名設定等。已結束或已取消的場次無法修改。
      </p>
      <EditSessionForm sessionId={sessionId} initialSession={session as Record<string, unknown>} />
    </div>
  )
}
