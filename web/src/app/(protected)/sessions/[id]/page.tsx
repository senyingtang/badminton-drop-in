'use client'

import { useEffect, useState, useCallback, useMemo, useRef, use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import { generateShareSignupCode } from '@/lib/share-signup-code'
import SessionStatusBadge from '@/components/sessions/SessionStatusBadge'
import ParticipantList from '@/components/sessions/ParticipantList'
import AddParticipantModal from '@/components/sessions/AddParticipantModal'
import RoundList from '@/components/rounds/RoundList'
import { getRentedCourtsDisplay } from '@/lib/rented-courts'
import { buildSessionCourtSlots, formatCourtSlotTitle } from '@/lib/session-court-slots'
import { getShuttlecockBrandFromSession, getShuttlecockOptionFromSession } from '@/lib/shuttlecock'
import { liffQuickSignupEntryPath, signupPublicPath } from '@/lib/signupShareLinks'
import styles from './session-detail.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionRow = any

const statusTransitions: Record<string, { label: string; next: string; color: string }[]> = {
  draft: [
    { label: '開放報名', next: 'registration_open', color: 'blue' },
  ],
  registration_open: [
    { label: '確認名單', next: 'ready_for_assignment', color: 'green' },
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
  const supabase = createClient()
  const { user } = useUser()

  const [session, setSession] = useState<SessionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [buildSha, setBuildSha] = useState<string>('')
  const hostPrepareDoneRef = useRef<string | null>(null)

  const fetchSession = useCallback(async () => {
    const { data: row, error: sessionErr } = await supabase
      .from('sessions')
      .select('*, venues(name)')
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionErr) {
      console.error('fetchSession sessions:', sessionErr.message)
      setSession(null)
      setLoading(false)
      return
    }

    if (!row) {
      setSession(null)
      setLoading(false)
      return
    }

    let sessionCourts: Array<{ court_no: number; sort_order: number; label: string | null }> = []
    const { data: courtRows, error: courtsErr } = await supabase
      .from('session_courts')
      .select('court_no, sort_order, label')
      .eq('session_id', sessionId)
      .order('sort_order', { ascending: true })

    if (courtsErr) {
      console.warn('fetchSession session_courts:', courtsErr.message)
    } else if (courtRows) {
      sessionCourts = courtRows as typeof sessionCourts
    }

    setSession({ ...row, session_courts: sessionCourts })
    setLoading(false)
  }, [sessionId, supabase])

  const ensureShareSignupCode = useCallback(async (): Promise<string | null> => {
    if (!session?.allow_self_signup) return null
    let code = session.share_signup_code as string | null
    if (!code) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const next = generateShareSignupCode()
        const { error: upErr } = await supabase.from('sessions').update({ share_signup_code: next }).eq('id', sessionId)
        if (!upErr) {
          code = next
          await fetchSession()
          break
        }
        if ((upErr as { code?: string }).code !== '23505') {
          alert(upErr.message || '無法產生分享碼')
          return null
        }
      }
    }
    if (!code) {
      alert('無法產生分享碼，請稍後再試')
      return null
    }
    return code
  }, [session, sessionId, supabase, fetchSession])

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

  /** 團主進頁：session_prepare_for_host（團主入場等，需 DB 057）；與 session_courts 無關 */
  useEffect(() => {
    if (!session || !user?.id) return
    if (String(session.host_user_id) !== String(user.id)) return
    if (hostPrepareDoneRef.current === sessionId) return
    hostPrepareDoneRef.current = sessionId
    void (async () => {
      const { error } = await supabase.rpc('session_prepare_for_host', { p_session_id: sessionId })
      if (error) {
        console.warn('session_prepare_for_host:', error.message)
        return
      }
      await fetchSession()
    })()
  }, [session, user?.id, sessionId, supabase, fetchSession])

  const handleStatusChange = async (newStatus: string) => {
    setActionLoading(true)
    try {
      if (newStatus === 'registration_open') {
        const { data, error } = await supabase.rpc('kb_open_registration_with_billing', {
          p_session_id: sessionId,
        })
        if (error) throw error
        if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
          throw new Error('開放報名失敗')
        }
      } else {
        await supabase
          .from('sessions')
          .update({ status: newStatus })
          .eq('id', sessionId)
      }

      await fetchSession()
    } catch (err) {
      console.error('Status change failed:', err)
      const msg =
        err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : ''
      if (msg.includes('WALLET_INSUFFICIENT_BALANCE')) {
        // New RPC includes fee info in its exception metadata; but when it surfaces as message only,
        // we fall back to rule-based hints.
        // Default: monthly overage NT$50.
        const feeHint = msg.includes('8000') || msg.includes('NT$80') ? 80 : 50
        if (feeHint === 80) {
          alert('儲值金不足，本次開放報名需 NT$80，請先儲值。')
        } else {
          alert('儲值金不足，本次月費超額開放報名需 NT$50，請先儲值。')
        }
      } else if (msg) {
        alert(`操作失敗：${msg}`)
      } else {
        alert('操作失敗，請稍後重試。')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm('確定要取消此場次嗎？此操作無法復原。')) return
    await handleStatusChange('cancelled')
  }

  const sessionCourtSlots = useMemo(() => {
    if (!session) return []
    return buildSessionCourtSlots(
      session.session_courts as Array<{ sort_order: number; court_no: number; label: string | null }> | undefined,
      Number(session.court_count) || 1,
      session.metadata
    )
  }, [session])

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
  const courtsLineFromSlots =
    sessionCourtSlots.length > 0 ? sessionCourtSlots.map(formatCourtSlotTitle).join('、') : null
  const rentedCourtsDisplay = courtsLineFromSlots || getRentedCourtsDisplay(session.metadata)

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
                {!shuttleBrand ? (
                  <span className={styles.infoSub}> · {shuttleOpt.hintZh}</span>
                ) : null}
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
            <div className={styles.sectionHeaderActions}>
              {session.allow_self_signup && (
                <div className={styles.shareSignupWrap}>
                  <div className={styles.shareSignupRow}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const code = await ensureShareSignupCode()
                        if (!code) return
                        const url = `${window.location.origin}${liffQuickSignupEntryPath(code)}`
                        try {
                          await navigator.clipboard.writeText(url)
                          alert('已複製 LINE 快速報名連結！')
                        } catch {
                          alert('複製失敗，請手動複製連結。')
                        }
                      }}
                    >
                      複製 LINE 快速報名連結
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--brand-end)', borderColor: 'var(--brand-end)' }}
                      onClick={async () => {
                        const code = await ensureShareSignupCode()
                        if (!code) return
                        const url = `${window.location.origin}${signupPublicPath(code)}`
                        try {
                          await navigator.clipboard.writeText(url)
                          alert('已複製一般報名頁連結！')
                        } catch {
                          alert('複製失敗，請手動複製連結。')
                        }
                      }}
                    >
                      複製一般報名頁
                    </button>
                    <Link
                      className="btn btn-ghost btn-sm"
                      href={session.share_signup_code ? signupPublicPath(session.share_signup_code as string) : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={async (e) => {
                        if (session.share_signup_code) return
                        e.preventDefault()
                        const code = await ensureShareSignupCode()
                        if (code) window.open(signupPublicPath(code), '_blank', 'noopener,noreferrer')
                      }}
                    >
                      開啟報名頁
                    </Link>
                  </div>
                  <p className={styles.shareSignupHint}>
                    建議發布到 LINE 社群、IG、FB 使用，球友會優先使用 LINE App 登入報名。
                  </p>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                   const { exportToCSV } = await import('@/lib/utils/export')
                   // Fetch participants
                   const { data } = await supabase
                     .from('session_participants')
                     .select('id, status, priority_order, session_effective_level, players(player_code, display_name, gender, age)')
                     .eq('session_id', sessionId)
                     .eq('is_removed', false)
                     .order('created_at', { ascending: true })
                   
                   if (data && data.length > 0) {
                     type ExportRow = {
                       id: string
                       status: string
                       priority_order: number | null
                       session_effective_level: number | null
                       players: { player_code?: string | null; display_name?: string | null; gender?: string | null; age?: number | null } | null
                     }

                     const formattedRows = (data as unknown as ExportRow[]).map((row) => ({
                       '名單ID': row.id,
                       '狀態': row.status,
                       '順位(若候補)': row.priority_order ?? '',
                       '打球級別': row.session_effective_level ?? '',
                       '球員編號': row.players?.player_code ?? '',
                       '玩家稱呼': row.players?.display_name ?? '',
                       '性別': row.players?.gender ?? '',
                       '年齡': row.players?.age ?? '',
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

      {/* Rounds：開放報名後即可預排／管理輪次 */}
      {[
        'pending_confirmation',
        'registration_open',
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
            sessionCourtSlots={sessionCourtSlots}
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
