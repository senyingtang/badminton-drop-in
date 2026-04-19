'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import SessionCard from '@/components/sessions/SessionCard'
import styles from './sessions.module.css'

type StatusFilter =
  | 'all'
  | 'draft'
  | 'pending_confirmation'
  | 'pre_play'
  | 'playing'
  | 'finished'
  | 'cancelled'

const filterTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'pending_confirmation', label: '報名中' },
  { key: 'pre_play', label: '待排組' },
  { key: 'playing', label: '開打中' },
  { key: 'finished', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
]

const prePlayStatuses = ['ready_for_assignment', 'assigned']
const playingStatuses = ['in_progress', 'round_finished']

const TERMINAL_STATUSES = ['cancelled', 'session_finished']

interface SessionRow {
  id: string
  status: string
  title: string
  start_at: string
  end_at: string
  court_count: number
  allow_self_signup: boolean
  metadata?: unknown
  venues?: { name: string } | null
  session_participants?: { count: number }[]
}

export default function SessionsPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const fetchSessions = useCallback(async () => {
    if (!user) return
    setLoading(true)
    let query = supabase
      .from('sessions')
      .select('*, venues(name), session_participants(count)')
      .eq('host_user_id', user.id)
      .order('start_at', { ascending: false })

    if (filter === 'draft') {
      query = query.eq('status', 'draft')
    } else if (filter === 'pending_confirmation') {
      query = query.eq('status', 'pending_confirmation')
    } else if (filter === 'pre_play') {
      query = query.in('status', prePlayStatuses)
    } else if (filter === 'playing') {
      query = query.in('status', playingStatuses)
    } else if (filter === 'finished') {
      query = query.eq('status', 'session_finished')
    } else if (filter === 'cancelled') {
      query = query.eq('status', 'cancelled')
    }

    const { data, error } = await query
    if (error) {
      console.error(error)
      setSessions([])
    } else {
      setSessions((data as SessionRow[]) || [])
    }
    setLoading(false)
  }, [user, filter, supabase])

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    setSelectedIds([])
  }, [filter])

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds([])
      return !prev
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selectAllVisible = () => {
    setSelectedIds(sessions.map((s) => s.id))
  }

  const clearSelection = () => setSelectedIds([])

  const cancelableIds = selectedIds.filter((id) => {
    const st = sessions.find((s) => s.id === id)?.status
    return st != null && !TERMINAL_STATUSES.includes(st)
  })

  const draftIdsInSelection = selectedIds.filter(
    (id) => sessions.find((s) => s.id === id)?.status === 'draft'
  )

  const handleBatchCancel = async () => {
    if (!user || cancelableIds.length === 0) {
      window.alert('請選取至少一筆可取消的場次（已完成與已取消除外）。')
      return
    }
    if (
      !window.confirm(
        `確定要將選取的 ${cancelableIds.length} 筆場次標記為「已取消」？已報名者將無法再進行該場次活動。`
      )
    ) {
      return
    }
    setLoading(true)
    const { error } = await supabase
      .from('sessions')
      .update({ status: 'cancelled' })
      .in('id', cancelableIds)
      .eq('host_user_id', user.id)
    setLoading(false)
    if (error) {
      window.alert(`批次取消失敗：${error.message}`)
      return
    }
    setSelectedIds([])
    await fetchSessions()
  }

  const handleBatchDeleteDrafts = async () => {
    if (!user || draftIdsInSelection.length === 0) {
      window.alert('請選取至少一筆「草稿」場次才能刪除。')
      return
    }
    if (
      !window.confirm(
        `將永久刪除 ${draftIdsInSelection.length} 筆草稿場次，無法復原。確定嗎？`
      )
    ) {
      return
    }
    setLoading(true)
    const { error } = await supabase
      .from('sessions')
      .delete()
      .in('id', draftIdsInSelection)
      .eq('host_user_id', user.id)
    setLoading(false)
    if (error) {
      window.alert(`刪除草稿失敗：${error.message}`)
      return
    }
    setSelectedIds((prev) => prev.filter((id) => !draftIdsInSelection.includes(id)))
    await fetchSessions()
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>場次管理</h1>
          <p className={styles.subtitle}>管理您的羽球場次、報名與排組</p>
        </div>
        <Link href="/sessions/new" className={`btn btn-primary ${styles.headerCta}`}>
          ＋ 建立場次
        </Link>
      </div>

      <div className={styles.tabs}>
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tab} ${filter === tab.key ? styles.tabActive : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.toolsRow}>
        <button type="button" className="btn btn-secondary" onClick={toggleSelectionMode}>
          {selectionMode ? '結束批次' : '批次操作'}
        </button>
        {selectionMode && (
          <>
            <button type="button" className="btn btn-ghost" onClick={selectAllVisible}>
              全選此頁
            </button>
            <button type="button" className="btn btn-ghost" onClick={clearSelection}>
              清除選取
            </button>
            <span className={styles.batchHint}>已選 {selectedIds.length} 筆</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={cancelableIds.length === 0 || loading}
              onClick={() => void handleBatchCancel()}
            >
              批次取消
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={draftIdsInSelection.length === 0 || loading}
              onClick={() => void handleBatchDeleteDrafts()}
              title="僅會刪除選取項目中的草稿"
            >
              刪除草稿
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>載入場次中...</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🏸</span>
          <p className={styles.emptyTitle}>
            {filter === 'all' ? '尚無場次' : `沒有「${filterTabs.find((t) => t.key === filter)?.label}」的場次`}
          </p>
          <p className={styles.emptyDesc}>開始建立您的第一個羽球場次！</p>
          <Link href="/sessions/new" className="btn btn-primary">
            建立場次
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              selectionMode={selectionMode}
              selected={selectedIds.includes(session.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
