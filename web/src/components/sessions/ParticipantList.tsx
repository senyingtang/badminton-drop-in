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

  const fetchParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('session_participants')
      .select('*, players(id, player_code, display_name)')
      .eq('session_id', sessionId)
      .eq('is_removed', false)
      .order('priority_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    setParticipants(data || [])
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
    } catch (err) {
      console.error('Status change failed:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const handlePromote = async () => {
    setActionLoading('promote')
    try {
      await supabase.rpc('promote_next_waitlist_participant', {
        input_session_id: sessionId,
      })
    } catch (err) {
      console.error('Promotion failed:', err)
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
          <span className={styles.playerName}>{p.players?.display_name || '未知'}</span>
          <span className={styles.playerCode}>{p.players?.player_code || ''}</span>
        </div>
        <div className={styles.level}>
          {p.session_effective_level ? `Lv.${p.session_effective_level}` : '—'}
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
              <button
                className={`${styles.actionBtn} ${styles.dangerBtn}`}
                onClick={() => handleStatusChange(p.id, 'cancelled')}
                disabled={actionLoading === p.id}
                title="取消"
              >
                ✕
              </button>
            )}
            {p.status === 'waitlist' && (
              <button
                className={`${styles.actionBtn} ${styles.dangerBtn}`}
                onClick={() => handleStatusChange(p.id, 'cancelled')}
                disabled={actionLoading === p.id}
                title="取消"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.container}>
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
