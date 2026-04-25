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

/** RPC `list_session_participants_for_host` 一列（host_confirmed_level 需 DB 套用 023 後才有） */
interface ListHostParticipantRpcRow {
  session_participant_id: string
  session_id: string
  player_id: string
  source_type: string
  status: string
  priority_order: number | null
  waitlist_order: number | null
  self_level: number | null
  host_confirmed_level?: number | null
  session_effective_level: number | null
  signup_note: string | null
  is_removed: boolean
  created_at: string
  player_code: string | null
  display_name: string | null
  total_matches_played?: number
  consecutive_rounds_played?: number
  is_locked_for_current_round?: boolean
}

const LEVEL_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1)

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
  const [paidLoading, setPaidLoading] = useState<string | null>(null)
  const [undo, setUndo] = useState<{
    participantId: string
    prevStatus: string
    prevWaitlistOrder: number | null
    expiresAt: number
  } | null>(null)

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

    // 補抓一次性匿名暱稱（session_display_name）與繳費欄位（paid_at）
    const otMap = new Map<string, string>()
    const paidAtMap = new Map<string, string | null>()
    const { data: spRows, error: spErr } = await supabase
      .from('session_participants')
      .select('id, session_display_name, paid_at')
      .eq('session_id', sessionId)

    if (spErr) {
      // paid_at 欄位可能尚未套用 migration，保持相容：退回只抓 session_display_name
      const msg = String(spErr.message || '')
      if (msg.includes('paid_at') || msg.toLowerCase().includes('does not exist')) {
        const { data: onlyNames, error: otErr } = await supabase
          .from('session_participants')
          .select('id, session_display_name')
          .eq('session_id', sessionId)
        if (otErr) {
          console.warn('load session_display_name failed:', otErr.message)
        }
        ;(onlyNames || []).forEach((r: unknown) => {
          if (!r || typeof r !== 'object') return
          const obj = r as Record<string, unknown>
          const id = obj.id
          const sdn = obj.session_display_name
          if (id && typeof sdn === 'string') {
            const v = sdn.trim()
            if (v) otMap.set(String(id), v)
          }
        })
      } else {
        console.warn('load session participant extra fields failed:', spErr.message)
      }
    } else {
      ;(spRows || []).forEach((r: unknown) => {
        if (!r || typeof r !== 'object') return
        const obj = r as Record<string, unknown>
        const rawId = obj.id
        if (!rawId) return
        const id = String(rawId)

        const sdn = obj.session_display_name
        if (typeof sdn === 'string') {
          const v = sdn.trim()
          if (v) otMap.set(id, v)
        }

        const paidAt = obj.paid_at
        paidAtMap.set(id, typeof paidAt === 'string' ? paidAt : paidAt == null ? null : String(paidAt))
      })
    }

    // Map RPC result shape back to existing UI shape
    const rows = (data || []).map((r: ListHostParticipantRpcRow) => ({
      id: r.session_participant_id,
      session_id: r.session_id,
      player_id: r.player_id,
      source_type: r.source_type,
      status: r.status,
      priority_order: r.priority_order,
      waitlist_order: r.waitlist_order,
      self_level: r.self_level,
      host_confirmed_level: r.host_confirmed_level ?? null,
      session_effective_level: r.session_effective_level,
      total_matches_played: r.total_matches_played ?? 0,
      consecutive_rounds_played: r.consecutive_rounds_played ?? 0,
      is_locked_for_current_round: r.is_locked_for_current_round ?? false,
      signup_note: r.signup_note,
      is_removed: r.is_removed,
      created_at: r.created_at,
      session_display_name: otMap.get(r.session_participant_id) || null,
      paid_at: paidAtMap.get(r.session_participant_id) ?? null,
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

  const handleStatusChange = async (participantId: string, newStatus: string, previousStatus?: string) => {
    setActionLoading(participantId)
    try {
      await supabase.rpc('confirm_participant_status', {
        input_session_participant_id: participantId,
        input_new_status: newStatus,
      })
      await fetchParticipants()
      if (
        previousStatus === 'waitlist' &&
        (newStatus === 'confirmed_main' || newStatus === 'promoted_from_waitlist')
      ) {
        void fetch('/api/line/notify-waitlist-promotion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionParticipantId: participantId }),
        }).catch(() => {})
      }
    } catch (err) {
      console.error('Status change failed:', err)
      alert('操作失敗，請稍後再試')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelWithUndo = async (p: ParticipantRow) => {
    const prevStatus = String(p.status)
    const prevWaitlistOrder = p.waitlist_order != null ? Number(p.waitlist_order) : null
    await handleStatusChange(p.id, 'cancelled')
    const expiresAt = Date.now() + 10_000
    setUndo({ participantId: p.id, prevStatus, prevWaitlistOrder, expiresAt })
    setTimeout(() => {
      setUndo((cur) =>
        cur && cur.participantId === p.id && cur.expiresAt === expiresAt ? null : cur
      )
    }, 10_000)
  }

  const handleUndo = async () => {
    if (!undo) return
    if (Date.now() > undo.expiresAt) {
      setUndo(null)
      return
    }
    setActionLoading(undo.participantId)
    try {
      await supabase.rpc('confirm_participant_status', {
        input_session_participant_id: undo.participantId,
        input_new_status: undo.prevStatus,
      })
      if (undo.prevStatus === 'waitlist' && undo.prevWaitlistOrder) {
        await supabase.rpc('host_set_waitlist_order', {
          input_session_participant_id: undo.participantId,
          input_new_order: undo.prevWaitlistOrder,
        })
      }
      await fetchParticipants()
      setUndo(null)
    } catch (err) {
      console.error('復原失敗:', err)
      alert('復原失敗，請稍後再試')
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
  const canEditLevels = [
    'draft',
    'pending_confirmation',
    'ready_for_assignment',
    'assigned',
    'in_progress',
    'round_finished',
  ].includes(sessionStatus)

  const canTogglePaid = true

  const handleTogglePaid = async (p: ParticipantRow, nextChecked: boolean) => {
    setPaidLoading(p.id)
    try {
      const { error } = await supabase.rpc('host_set_participant_paid_status', {
        input_session_participant_id: p.id,
        input_is_paid: nextChecked,
      })
      if (error) throw error
      await fetchParticipants()
    } catch (err) {
      console.error('Paid status update failed:', err)
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : ''
      if (msg.includes('Could not find the function') || msg.includes('does not exist')) {
        alert(
          '更新繳費狀態需要資料庫函式 host_set_participant_paid_status。請在 Supabase SQL Editor 執行 docs/045_session_participant_paid_status.sql 後再試。'
        )
      } else if (msg.includes('forbidden') || msg.includes('unauthorized')) {
        alert('沒有權限變更繳費狀態（僅主辦／場館管理者／平台管理員）。')
      } else {
        alert('更新繳費狀態失敗，請稍後再試。')
      }
    } finally {
      setPaidLoading(null)
    }
  }

  const handleHostLevelChange = async (participantId: string, newLevel: number) => {
    setActionLoading(participantId)
    try {
      const { error } = await supabase.rpc('host_set_participant_session_level', {
        input_session_participant_id: participantId,
        input_level: newLevel,
      })
      if (error) throw error
      await fetchParticipants()
    } catch (err) {
      console.error('Host level update failed:', err)
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : ''
      if (msg.includes('Could not find the function') || msg.includes('does not exist')) {
        alert(
          '更新級數需要資料庫函式 host_set_participant_session_level。請在 Supabase SQL Editor 執行 docs/024_host_set_participant_session_level_rpc.sql 後再試。'
        )
      } else if (code === 'P0001' || msg.includes('forbidden')) {
        alert('沒有權限變更此球員級數（僅主辦／場館管理者／平台管理員）。')
      } else {
        alert('更新級數失敗。若你確定是主辦，請確認已在 Supabase 套用 024 migration，或稍後再試。')
      }
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  const renderParticipant = (p: ParticipantRow) => {
    const st = statusLabels[p.status] || { label: p.status, color: 'gray' }
    const canPickLevel =
      canEditLevels &&
      !['cancelled', 'no_show', 'unavailable', 'completed'].includes(p.status)
    const levelValue = Number(p.session_effective_level ?? p.self_level ?? 6)
    const showPlayedMeta = ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
    const isMain = ['confirmed_main', 'promoted_from_waitlist', 'completed'].includes(p.status)
    const isPaid = Boolean(p.paid_at)
    const paidDisabled = paidLoading === p.id || actionLoading === p.id

    return (
      <div key={p.id} className={`${styles.row} ${canManage ? styles.rowHasToolbar : ''}`}>
        <div className={styles.playerInfo}>
          <div className={styles.playerIdentity}>
            <div className={styles.nameRow}>
              <span className={styles.playerName}>
                {(p.players?.display_name || '未知') +
                  (p.session_display_name ? ` - ${String(p.session_display_name)}` : '')}
              </span>
              {p.players?.player_code ? (
                <span className={styles.playerCode}>{p.players.player_code}</span>
              ) : null}
            </div>
            {(showPlayedMeta || p.signup_note) && (
              <div className={styles.detailRow}>
                {showPlayedMeta && (
                  <span className={styles.playedMeta}>上場 {Number(p.total_matches_played ?? 0)} 場</span>
                )}
                {p.signup_note ? (
                  <span className={styles.playerNote}>備註：{p.signup_note}</span>
                ) : null}
              </div>
            )}
            {p.status === 'waitlist' && (
              <div className={styles.subRow}>候補順序：{p.waitlist_order ?? '—'}</div>
            )}
          </div>
        </div>
        <div className={styles.levelCell}>
          {canPickLevel ? (
            <select
              className={styles.levelSelect}
              value={String(levelValue)}
              onChange={(e) => handleHostLevelChange(p.id, Number(e.target.value))}
              disabled={actionLoading === p.id}
              aria-label={`${p.players?.display_name ?? '球員'} 當場級數`}
            >
              {LEVEL_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  Lv.{n}
                </option>
              ))}
            </select>
          ) : (
            <div className={styles.level}>
              {p.session_effective_level
                ? `Lv.${p.session_effective_level}`
                : p.self_level
                  ? `自評 Lv.${p.self_level}`
                  : '—'}
            </div>
          )}
          {p.host_confirmed_level != null && (
            <span className={styles.hostLevelTag}>團主訂級</span>
          )}
        </div>
        <div className={styles.paidCell}>
          {isMain ? (
            <button
              type="button"
              className={styles.paidToggle}
              data-checked={isPaid ? 'true' : 'false'}
              onClick={() => {
                if (!canTogglePaid) return
                void handleTogglePaid(p, !isPaid)
              }}
              disabled={!canTogglePaid || paidDisabled}
              aria-disabled={!canTogglePaid || paidDisabled}
              title="切換繳費狀態"
            >
              <input
                className={styles.paidCheckbox}
                type="checkbox"
                checked={isPaid}
                onChange={(e) => {
                  if (!canTogglePaid) return
                  void handleTogglePaid(p, e.target.checked)
                }}
                disabled={!canTogglePaid || paidDisabled}
                aria-label={`${p.players?.display_name ?? '球員'} 已繳費`}
              />
              已繳費
            </button>
          ) : (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>—</span>
          )}
        </div>
        <span className={`${styles.statusBadge} ${styles[st.color]}`}>{st.label}</span>
        {canManage && (
          <div className={styles.actions}>
            {p.status === 'pending' && (
              <>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleStatusChange(p.id, 'confirmed_main', p.status)}
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
                  onClick={() => handleCancelWithUndo(p)}
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
                  onClick={() => handleStatusChange(p.id, 'confirmed_main', p.status)}
                  disabled={actionLoading === p.id}
                  title="轉正選"
                >
                  ✓
                </button>
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
                  onClick={() => handleCancelWithUndo(p)}
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
      {undo && Date.now() < undo.expiresAt && (
        <div className={styles.undoBar}>
          <span>
            已取消報名，可於 {Math.ceil((undo.expiresAt - Date.now()) / 1000)} 秒內復原。
          </span>
          <button className={styles.undoBtn} onClick={handleUndo} type="button">
            復原
          </button>
        </div>
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
