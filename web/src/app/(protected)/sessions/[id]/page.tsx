'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import { generateShareSignupCode } from '@/lib/share-signup-code'
import SessionStatusBadge from '@/components/sessions/SessionStatusBadge'
import ParticipantList from '@/components/sessions/ParticipantList'
import AddParticipantModal from '@/components/sessions/AddParticipantModal'
import RoundList from '@/components/rounds/RoundList'
import { getRentedCourtsDisplay } from '@/lib/rented-courts'
import { getShuttlecockBrandFromSession, getShuttlecockOptionFromSession } from '@/lib/shuttlecock'
import styles from './session-detail.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionRow = any

const statusTransitions: Record<string, { label: string; next: string; color: string }[]> = {
  draft: [
    { label: '開始報名', next: 'pending_confirmation', color: 'blue' },
  ],
  pending_confirmation: [
    { label: '確認名單', next: 'ready_for_assignment', color: 'green' },
  ],
  ready_for_assignment: [],
  in_progress: [],
  round_finished: [],
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { user } = useUser()

  const [session, setSession] = useState<SessionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [buildSha, setBuildSha] = useState<string>('')

  const fetchSession = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*, venues(name)')
      .eq('id', sessionId)
      .single()

    setSession(data)
    setLoading(false)
  }, [sessionId, supabase])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  useEffect(() => {
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBuildSha(j?.sha_short || j?.sha?.slice?.(0, 7) || ''))
      .catch(() => setBuildSha(''))
  }, [])

  // Realtime for session status changes
  useEffect(() => {
    const channel = supabase
      .channel(`session-status-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => {
          fetchSession()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, supabase, fetchSession])

  const handleStatusChange = async (newStatus: string) => {
    setActionLoading(true)
    try {
      await supabase
        .from('sessions')
        .update({ status: newStatus })
        .eq('id', sessionId)

      await fetchSession()
    } catch (err) {
      console.error('Status change failed:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm('確定要取消此場次嗎？此操作無法復原。')) return
    await handleStatusChange('cancelled')
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入場次...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className={styles.notFound}>
        <p>找不到此場次</p>
        <Link href="/sessions" className="btn btn-ghost">
          回到場次列表
        </Link>
      </div>
    )
  }

  const startDate = new Date(session.start_at)
  const endDate = new Date(session.end_at)
  const transitions = statusTransitions[session.status] || []
  const canManage = !['session_finished', 'cancelled'].includes(session.status)
  const canEditSessionCore =
    Boolean(user?.id && session.host_user_id === user.id && !['session_finished', 'cancelled'].includes(String(session.status)))
  const shuttleOpt = getShuttlecockOptionFromSession(session)
  const shuttleBrand = getShuttlecockBrandFromSession(session)
  const rentedCourtsDisplay = getRentedCourtsDisplay(session.metadata)

  return (
    <div className={styles.page}>
      {/* Breadcrumb */}
      <div className={styles.breadcrumb}>
        <Link href="/sessions" className={styles.breadcrumbLink}>場次管理</Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{session.title}</span>
        {buildSha && <span className={styles.breadcrumbSep}>·</span>}
        {buildSha && <span className={styles.breadcrumbCurrent}>build {buildSha}</span>}
      </div>

      {/* Info Card */}
      <div className={styles.infoCard}>
        <div className={styles.infoHeader}>
          <div>
            <div className={styles.infoTitleRow}>
              <h1 className={styles.infoTitle}>{session.title}</h1>
              <SessionStatusBadge status={session.status} />
              {canEditSessionCore && (
                <Link href={`/sessions/${sessionId}/edit`} className="btn btn-secondary btn-sm">
                  編輯場次
                </Link>
              )}
            </div>
            {session.description && (
              <p className={styles.infoDesc}>{session.description}</p>
            )}
          </div>
        </div>

        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.infoIcon}>📅</span>
            <div>
              <span className={styles.infoLabel}>日期</span>
              <span className={styles.infoValue}>
                {startDate.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </span>
            </div>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoIcon}>🕐</span>
            <div>
              <span className={styles.infoLabel}>時間</span>
              <span className={styles.infoValue}>
                {startDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} – {endDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoIconShuttle}>
              <img src={shuttleOpt.imagePath} alt="" width={22} height={22} />
            </span>
            <div>
              <span className={styles.infoLabel}>用球</span>
              <span className={styles.infoValue}>
                {shuttleOpt.labelZh}
                {shuttleBrand ? (
                  <>
                    {' '}
                    <span className={styles.infoBrand}>· {shuttleBrand}</span>
                  </>
                ) : null}
                <span className={styles.infoSub}> · {shuttleOpt.hintZh}</span>
              </span>
            </div>
          </div>
          {rentedCourtsDisplay && (
            <div className={styles.infoItem}>
              <span className={styles.infoIcon}>🥅</span>
              <div>
                <span className={styles.infoLabel}>租借場地</span>
                <span className={styles.infoValue}>{rentedCourtsDisplay}</span>
              </div>
            </div>
          )}
          <div className={styles.infoItem}>
            <span className={styles.infoIcon}>🏸</span>
            <div>
              <span className={styles.infoLabel}>場地</span>
              <span className={styles.infoValue}>
                {session.court_count} 面{session.venues?.name ? ` · ${session.venues.name}` : ''}
              </span>
            </div>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoIcon}>⚙️</span>
            <div>
              <span className={styles.infoLabel}>排組模式</span>
              <span className={styles.infoValue}>
                {session.assignment_mode === 'rotation_fair' ? '輪轉公平' : session.assignment_mode === 'hybrid' ? '混合' : '自訂'}
              </span>
            </div>
          </div>
        </div>

        {/* Status Actions */}
        {canManage && (
          <div className={styles.statusActions}>
            {transitions.map((t) => (
              <button
                key={t.next}
                className="btn btn-primary"
                onClick={() => handleStatusChange(t.next)}
                disabled={actionLoading}
              >
                {t.label}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              onClick={handleCancel}
              disabled={actionLoading}
            >
              取消場次
            </button>
          </div>
        )}
      </div>

      {/* Participants */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>球員名單</h2>
          {canManage && (
            <div style={{ display: 'flex', gap: '8px' }}>
              {session.allow_self_signup && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--brand-end)', borderColor: 'var(--brand-end)' }}
                  onClick={async () => {
                    let code = session.share_signup_code as string | null
                    if (!code) {
                      for (let attempt = 0; attempt < 5; attempt++) {
                        const next = generateShareSignupCode()
                        const { error: upErr } = await supabase
                          .from('sessions')
                          .update({ share_signup_code: next })
                          .eq('id', sessionId)
                        if (!upErr) {
                          code = next
                          await fetchSession()
                          break
                        }
                        if ((upErr as { code?: string }).code !== '23505') {
                          alert(upErr.message || '無法產生分享碼')
                          return
                        }
                      }
                    }
                    if (!code) {
                      alert('無法產生分享碼，請稍後再試')
                      return
                    }
                    const signupUrl = `${window.location.origin}/s/${code}`
                    try {
                      await navigator.clipboard.writeText(signupUrl)
                      alert('已複製報名連結！')
                    } catch {
                      alert('複製失敗，請手動複製連結。')
                    }
                  }}
                >
                  🔗 複製報名連結
                </button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                   const { exportToCSV } = await import('@/lib/utils/export')
                   // Fetch participants
                   const { data } = await supabase.from('session_participants').select('id, status, priority_order, session_effective_level, players(player_code, display_name, gender, age)').eq('session_id', sessionId).eq('is_removed', false).order('created_at', { ascending: true })
                   
                   if (data && data.length > 0) {
                     const formattedRows = data.map((row: any) => ({
                       '名單ID': row.id,
                       '狀態': statusTransitions[row.status] ? row.status : row.status, // We could map to nice labels
                       '順位(若候補)': row.priority_order || '',
                       '打球級別': row.session_effective_level || '',
                       '球員編號': row.players?.player_code || '',
                       '玩家稱呼': row.players?.display_name || '',
                       '性別': row.players?.gender || '',
                       '年齡': row.players?.age || ''
                     }))
                     exportToCSV(formattedRows, `session_${sessionId}_participants`)
                   } else {
                     alert('無球員可匯出')
                   }
                }}
              >
                📥 匯出 CSV
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddModal(true)}
              >
                ＋ 新增球員
              </button>
            </div>
          )}
        </div>
        <ParticipantList sessionId={sessionId} sessionStatus={session.status} />
      </div>

      {/* Rounds */}
      {[
        'ready_for_assignment',
        'assigned',
        'in_progress',
        'round_finished',
        'session_finished',
      ].includes(session.status) && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>輪次管理</h2>
          </div>
          <RoundList
            sessionId={sessionId}
            sessionStatus={session.status}
            courtCount={session.court_count}
            onSessionRefresh={fetchSession}
          />
        </div>
      )}

      {/* Add Participant Modal */}
      <AddParticipantModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        sessionId={sessionId}
      />
    </div>
  )
}
