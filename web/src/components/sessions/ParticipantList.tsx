'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './ParticipantList.module.css'

const statusLabels: Record<string, { label: string; color: string }> = {
  pending:                 { label: '待確認', color: 'blue' },
  confirmed_main:          { label: '正選',   color: 'green' },
  waitlist:                { label: '候補',   color: 'orange' },
  promoted_from_waitlist:  { label: '遞補',   color: 'purple' },
  cancelled:               { label: '已取消', color: 'red' },
  no_show:                 { label: '未到',   color: 'red' },
  unavailable:             { label: '無法出席', color: 'gray' },
  completed:               { label: '完成',   color: 'purple' },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParticipantRow = any

interface ParticipantListProps {
  sessionId: string
  sessionStatus: string
}

export default function ParticipantList({ sessionId, sessionStatus }: ParticipantListProps) {
  const supabase = createClient()
  const [participants, setParticipants] = useState<ParticipantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchParticipants = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.rpc('list_session_participants_for_host', {
      input_session_id: sessionId,
    })

    if (error) {
      console.error('fetchParticipants failed:', error)
      setLoadError(error.message)
      setParticipants([])
      setLoading(false)
      return
    }

    // Map RPC result shape back to existing UI shape
    const rows = (data || []).map((r: any) => ({
      id: r.session_participant_id,
      session_id: r.session_id,
      player_id: r.player_id,
      source_type: r.source_type,
      status: r.status,
      priority_order: r.priority_order,
      waitlist_order: r.waitlist_order,
      self_level: r.self_level,
      session_effective_level: r.session_effective_level,
      is_removed: r.is_removed,
      created_at: r.created_at,
      players: {
        id: r.player_id,
        player_code: r.player_code,
        display_name: r.display_name,
      },
    }))

    setParticipants(rows)
    setLoading(false)
  }, [sessionId, supabase])

  // Initial fetch
  useEffect(() => {
    fetchParticipants()
  }, [fetchParticipants])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`session-participants-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          fetchParticipants()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, supabase, fetchParticipants])

  const mainList = participants.filter(
    (p) => ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
  )
  const waitlist = participants.filter((p) => p.status === 'waitlist')
  const pendingList = participants.filter((p) => p.status === 'pending')
  const otherList = participants.filter(
    (p) => ['cancelled', 'no_show', 'unavailable'].includes(p.status)
  )

  const handleStatusChange = async (participantId: string, newStatus: string) => {
    setActionLoading(participantId)
    try {
      await supabase.rpc('confirm_participant_status', {
        input_session_participant_id: participantId,
        input_new_status: newStatus,
      })
      await fetchParticipants()
    } catch (err) {
      console.error('Status change failed:', err)
      alert('操作失敗，請稍後再試')
    } finally {
      setActionLoading(null)
    }
  }

  const handlePromote = async () => {
    setActionLoading('promote')
    try {
      await supabase.rpc('promote_next_waitlist_participant_simple', {
        input_session_id: sessionId,
      })
      await fetchParticipants()
    } catch (err) {
      console.error('Promotion failed:', err)
      alert('遞補失敗，請稍後再試（可能沒有候補球員）')
    } finally {
      setActionLoading(null)
    }
  }

  const canManage = ['draft', 'pending_confirmation', 'ready_for_assignment'].includes(sessionStatus)

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  const renderParticipant = (p: ParticipantRow) => {
    const st = statusLabels[p.status] || { label: p.status, color: 'gray' }
    return (
      <div key={p.id} className={styles.row}>
        <div className={styles.playerInfo}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
              <span className={styles.playerName}>{p.players?.display_name || '未知'}</span>
              <span className={styles.playerCode}>{p.players?.player_code || ''}</span>
              {p.signup_note && (
                <span className={styles.playerNote}>
                  備註：{p.signup_note}
                </span>
              )}
            </div>
            {p.status === 'waitlist' && (
              <div className={styles.subRow}>候補順序：{p.waitlist_order ?? '—'}</div>
            )}
          </div>
        </div>
        <div className={styles.level}>
          {p.session_effective_level
            ? `Lv.${p.session_effective_level}`
            : p.self_level
              ? `自評 Lv.${p.self_level}`
              : '—'}
        </div>
        <span className={`${styles.statusBadge} ${styles[st.color]}`}>{st.label}</span>
        {canManage && (
          <div className={styles.actions}>
            {p.status === 'pending' && (
              <>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleStatusChange(p.id, 'confirmed_main')}
                  disabled={actionLoading === p.id}
                  title="確認正選"
                >
                  ✓
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleStatusChange(p.id, 'waitlist')}
                  disabled={actionLoading === p.id}
                  title="設為候補"
                >
                  ⏳
                </button>
              </>
            )}
            {['confirmed_main', 'promoted_from_waitlist'].includes(p.status) && (
              <>
                <button
                  className={styles.actionBtn}
                  onClick={async () => {
                    setActionLoading(p.id)
                    try {
                      await supabase.rpc('host_move_participant_to_waitlist', {
                        input_session_participant_id: p.id,
                      })
                      await fetchParticipants()
                    } catch (err) {
                      console.error('Move to waitlist failed:', err)
                      alert('移到候補失敗，請稍後再試')
                    } finally {
                      setActionLoading(null)
                    }
                  }}
                  disabled={actionLoading === p.id}
                  title="移到候補"
                >
                  ⏳
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.dangerBtn}`}
                  onClick={() => handleStatusChange(p.id, 'cancelled')}
                  disabled={actionLoading === p.id}
                  title="取消"
                >
                  ✕
                </button>
              </>
            )}
            {p.status === 'waitlist' && (
              <>
                <button
                  className={styles.actionBtn}
                  onClick={async () => {
                    const next = (p.waitlist_order || 1) - 1
                    if (next < 1) return
                    setActionLoading(p.id)
                    try {
                      await supabase.rpc('host_set_waitlist_order', {
                        input_session_participant_id: p.id,
                        input_new_order: next,
                      })
                      await fetchParticipants()
                    } finally {
                      setActionLoading(null)
                    }
                  }}
                  disabled={actionLoading === p.id || !p.waitlist_order || p.waitlist_order <= 1}
                  title="往前移"
                >
                  ↑
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={async () => {
                    const next = (p.waitlist_order || 0) + 1
                    setActionLoading(p.id)
                    try {
                      await supabase.rpc('host_set_waitlist_order', {
                        input_session_participant_id: p.id,
                        input_new_order: next,
                      })
                      await fetchParticipants()
                    } finally {
                      setActionLoading(null)
                    }
                  }}
                  disabled={actionLoading === p.id || !p.waitlist_order}
                  title="往後移"
                >
                  ↓
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.dangerBtn}`}
                  onClick={() => handleStatusChange(p.id, 'cancelled')}
                  disabled={actionLoading === p.id}
                  title="取消"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {loadError && (
        <p className={styles.emptyHint} style={{ color: '#f87171' }}>
          讀取名單失敗：{loadError}
        </p>
      )}
      {/* Pending */}
      {pendingList.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            待確認 <span className={styles.count}>{pendingList.length}</span>
          </h4>
          {pendingList.map(renderParticipant)}
        </div>
      )}

      {/* Main List */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          正選名單 <span className={styles.count}>{mainList.length}</span>
        </h4>
        {mainList.length === 0 ? (
          <p className={styles.emptyHint}>尚無正選球員</p>
        ) : (
          mainList.map(renderParticipant)
        )}
      </div>

      {/* Waitlist */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            候補名單 <span className={styles.count}>{waitlist.length}</span>
          </h4>
          {canManage && waitlist.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handlePromote}
              disabled={actionLoading === 'promote'}
            >
              ⬆ 遞補下一位
            </button>
          )}
        </div>
        {waitlist.length === 0 ? (
          <p className={styles.emptyHint}>無候補球員</p>
        ) : (
          waitlist.map(renderParticipant)
        )}
      </div>

      {/* Other (cancelled, no_show, etc.) */}
      {otherList.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            其他 <span className={styles.count}>{otherList.length}</span>
          </h4>
          {otherList.map(renderParticipant)}
        </div>
      )}
    </div>
  )
}
