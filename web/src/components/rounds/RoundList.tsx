'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generateAssignment, AssignmentResult, AssignablePlayer } from '@/lib/engine/assignment-engine'
import RoundPanel from './RoundPanel'
import { useRouter } from 'next/navigation'
import AssignmentPreview from './AssignmentPreview'
import BillingPreflightDialog from '../billing/BillingPreflightDialog'
import styles from './RoundList.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoundRow = any

type HostParticipantNameRow = {
  session_participant_id: string
  display_name: string | null
}

/**
 * 不要在 rounds 巢狀查詢裡 embed `players`：`players` 的 RLS 會呼叫
 * `user_can_access_player()`，其內部再查 `players`，可能造成 stack depth 遞迴。
 * RoundPanel 仍讀取 `session_participants.players.display_name`，在此補上即可。
 */
function enrichRoundsWithParticipantDisplayNames(
  rounds: RoundRow[],
  displayNameByParticipantId: Map<string, string | null>
): void {
  for (const r of rounds) {
    for (const m of r.matches || []) {
      for (const mt of m.match_teams || []) {
        for (const mtp of mt.match_team_players || []) {
          const sp = mtp.session_participants
          if (!sp?.id) continue
          const name = displayNameByParticipantId.get(sp.id)
          sp.players = {
            display_name: name ?? sp.players?.display_name ?? null,
          }
        }
      }
    }
  }
}

interface RoundListProps {
  sessionId: string
  sessionStatus: string
  courtCount: number
  onSessionRefresh: () => void
}

export default function RoundList({ sessionId, sessionStatus, courtCount, onSessionRefresh }: RoundListProps) {
  const supabase = createClient()
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const router = useRouter()

  // Billing preflight state
  const [showPreflight, setShowPreflight] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [preflightData, setPreflightData] = useState<any>(null)
  const [pendingRoundId, setPendingRoundId] = useState<string | null>(null)

  // Assignment preview state
  const [showPreview, setShowPreview] = useState(false)
  const [previewResult, setPreviewResult] = useState<AssignmentResult | null>(null)
  const [nextRoundNo, setNextRoundNo] = useState(1)
  const fetchRoundsSeq = useRef(0)

  const fetchRounds = useCallback(async () => {
    const seq = ++fetchRoundsSeq.current
    const [roundsRes, namesRes] = await Promise.all([
      supabase
        .from('rounds')
        .select(`
        *,
        matches(
          *,
          match_score_submissions(*),
          match_teams(
            *,
            match_team_players(
              *,
              session_participants!participant_id(
                id,
                session_effective_level
              )
            )
          )
        )
      `)
        .eq('session_id', sessionId)
        .order('round_no', { ascending: true }),
      supabase.rpc('list_session_participants_for_host', {
        input_session_id: sessionId,
      }),
    ])

    if (seq !== fetchRoundsSeq.current) return

    const { data, error } = roundsRes
    if (error) {
      console.error('fetchRounds failed:', error.message, error)
      setRounds([])
      setLoading(false)
      return
    }

    if (namesRes.error) {
      console.warn('fetchRounds: participant names RPC failed:', namesRes.error.message)
    }

    const nameMap = new Map<string, string | null>()
    if (namesRes.data) {
      for (const row of namesRes.data as HostParticipantNameRow[]) {
        nameMap.set(row.session_participant_id, row.display_name)
      }
    }

    const nextRounds = structuredClone(data || []) as RoundRow[]
    enrichRoundsWithParticipantDisplayNames(nextRounds, nameMap)
    setRounds(nextRounds)
    setLoading(false)
  }, [sessionId, supabase])

  useEffect(() => {
    fetchRounds()
  }, [fetchRounds])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`rounds-${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rounds',
        filter: `session_id=eq.${sessionId}`,
      }, () => {
        fetchRounds()
        onSessionRefresh()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId, supabase, fetchRounds, onSessionRefresh])

  // Get assignable players from session_participants
  const getAssignablePlayers = async (): Promise<AssignablePlayer[]> => {
    // Use host RPC to avoid RLS/nested select issues
    const { data, error } = await supabase.rpc('list_session_participants_for_host', {
      input_session_id: sessionId,
    })
    if (error || !data) {
      if (error) console.error('getAssignablePlayers failed:', error)
      return []
    }

    type HostParticipantRow = {
      session_participant_id: string
      status: string
      display_name: string | null
      session_effective_level: number | null
      self_level: number | null
    }

    const rows = data as HostParticipantRow[]
    return rows
      .filter((sp) => ['confirmed_main', 'promoted_from_waitlist'].includes(sp.status))
      .map((sp) => ({
        participantId: sp.session_participant_id,
        displayName: sp.display_name || '未知',
        level: sp.session_effective_level || sp.self_level || 6,
        totalPlayed: 0,
        consecutivePlayed: 0,
      }))
  }

  const handleGenerateAssignment = async () => {
    const players = await getAssignablePlayers()
    const currentMaxRound = rounds.length > 0 ? Math.max(...rounds.map(r => r.round_no)) : 0
    const roundNo = currentMaxRound + 1
    setNextRoundNo(roundNo)

    const result = generateAssignment(players, courtCount)
    setPreviewResult(result)
    setShowPreview(true)
  }

  const handleConfirmAssignment = async (result: AssignmentResult) => {
    setActionLoading(true)
    try {
      const inputPayload = {
        rule_summary: `${result.assignments.length} courts, avg diff ${result.debugInfo.avgLevelDiff.toFixed(1)}`,
        assignments: result.assignments.map((a) => ({
          courtNo: a.courtNo,
          team1: a.team1.map((p) => ({
            participantId: p.participantId,
            displayName: p.displayName,
            level: p.level,
          })),
          team2: a.team2.map((p) => ({
            participantId: p.participantId,
            displayName: p.displayName,
            level: p.level,
          })),
        })),
        debugInfo: { ...result.debugInfo },
      }

      const { data: rawRoundId, error } = await supabase.rpc(
        'apply_assignment_recommendation_and_create_round',
        {
          input_session_id: sessionId,
          input_round_no: nextRoundNo,
          input_payload: inputPayload,
        }
      )

      if (error) throw error
      const roundId =
        rawRoundId == null
          ? null
          : Array.isArray(rawRoundId)
            ? rawRoundId[0]
            : rawRoundId
      if (!roundId) throw new Error('round_not_created')
      await fetchRounds()
      onSessionRefresh()
      router.refresh()
    } catch (err) {
      console.error('Failed to confirm assignment:', err)
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '建立失敗'
      throw new Error(msg)
    } finally {
      setActionLoading(false)
    }
  }

  const handleLockRound = async (roundId: string, roundNo: number) => {
    setActionLoading(true)
    if (roundNo === 1) {
      // It's the first round, need to do billing preflight
      try {
        const { data, error } = await supabase.rpc('kb_billing_preflight_session_start', {
          p_session_id: sessionId,
        })
        if (error) throw error

        if (data.consume_mode === 'already_consumed') {
          // Already consumed somehow, just lock
          await executeLock(roundId)
        } else {
          // Show dialog depending on mode
          setPreflightData(data)
          setPendingRoundId(roundId)
          setShowPreflight(true)
        }
      } catch (err) {
        console.error('Preflight error:', err)
      } finally {
        setActionLoading(false)
      }
    } else {
      // Not first round, just lock directly
      await executeLock(roundId)
    }
  }

  const executeLock = async (roundId: string) => {
    setActionLoading(true)
    try {
      if (preflightData && preflightData.consume_mode !== 'already_consumed') {
        const { error: consumeErr } = await supabase.rpc('kb_billing_consume_on_session_start', {
          p_session_id: sessionId
        })
        if (consumeErr) throw consumeErr
      }

      await supabase.rpc('lock_round_and_increment_counters', {
        input_round_id: roundId,
      })
      setShowPreflight(false)
      setPreflightData(null)
      setPendingRoundId(null)
      await fetchRounds()
      onSessionRefresh()
    } catch (err) {
      console.error('Lock failed:', err)
      alert('開打失敗，可能是餘額不足或其他原因。請稍後重試。')
    } finally {
      setActionLoading(false)
    }
  }

  const handleFinishRound = async (roundId: string) => {
    setActionLoading(true)
    try {
      await supabase.rpc('finish_round_and_release_locks', {
        input_round_id: roundId,
      })
      await fetchRounds()
      onSessionRefresh()
    } catch (err) {
      console.error('Finish failed:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnlockRound = async (roundId: string) => {
    if (!confirm('確定要解鎖本輪？將回到草稿狀態，可重新調整或重新排組。')) return
    setActionLoading(true)
    try {
      await supabase.rpc('unlock_round_and_restore_counters', {
        input_round_id: roundId,
      })
      await fetchRounds()
      onSessionRefresh()
    } catch (err) {
      console.error('Unlock failed:', err)
      alert('解鎖失敗，請稍後再試')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRebuildDraftRound = async (roundId: string) => {
    if (!confirm('確定要重新排組本輪？將刪除本輪草稿與分組，並重新產生。')) return
    setActionLoading(true)
    try {
      const { error } = await supabase.rpc('host_delete_draft_round', {
        input_round_id: roundId,
      })
      if (error) throw error
      await fetchRounds()
      onSessionRefresh()
      await handleGenerateAssignment()
    } catch (err) {
      console.error('Rebuild failed:', err)
      alert('重新排組失敗，請稍後再試')
    } finally {
      setActionLoading(false)
    }
  }

  // Determine action states
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const hasDraftRound = latestRound?.status === 'draft'
  const hasLockedRound = latestRound?.status === 'locked'
  const canGenerate =
    ['ready_for_assignment', 'assigned', 'in_progress', 'round_finished'].includes(sessionStatus) &&
    !hasDraftRound &&
    !hasLockedRound

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Action bar */}
      <div className={styles.actionBar}>
        {canGenerate && (
          <button
            className="btn btn-primary"
            onClick={handleGenerateAssignment}
            disabled={actionLoading}
          >
            {rounds.length === 0 ? '🎯 產生第一輪排組' : '➕ 排下一輪'}
          </button>
        )}
        {sessionStatus === 'round_finished' && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              supabase
                .from('sessions')
                .update({ status: 'session_finished' })
                .eq('id', sessionId)
                .then(() => onSessionRefresh())
            }}
            disabled={actionLoading}
          >
            🏁 結束場次
          </button>
        )}
      </div>

      {/* Rounds */}
      {rounds.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎯</span>
          <p>尚未建立排組</p>
          <p className={styles.emptyHint}>確認名單後即可開始產生排組</p>
        </div>
      ) : (
        <div className={styles.roundsList}>
          {[...rounds].reverse().map((r) => (
            <RoundPanel
              key={r.id}
              round={r}
              onLock={r.status === 'draft' ? () => handleLockRound(r.id, r.round_no) : undefined}
              onUnlock={r.status === 'locked' ? () => handleUnlockRound(r.id) : undefined}
              onRebuild={r.status === 'draft' ? () => handleRebuildDraftRound(r.id) : undefined}
              onFinish={r.status === 'locked' ? () => handleFinishRound(r.id) : undefined}
              onRefresh={fetchRounds}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}

      {/* Assignment Preview Modal */}
      {previewResult && (
        <AssignmentPreview
          isOpen={showPreview}
          onClose={() => {
            setShowPreview(false)
            setPreviewResult(null)
          }}
          result={previewResult}
          roundNo={nextRoundNo}
          onConfirm={handleConfirmAssignment}
          onRegenerate={handleGenerateAssignment}
        />
      )}

      {/* Preflight Dialog */}
      {preflightData && (
        <BillingPreflightDialog
          isOpen={showPreflight}
          data={preflightData}
          loading={actionLoading}
          onConfirm={() => pendingRoundId && executeLock(pendingRoundId)}
          onCancel={() => {
            setShowPreflight(false)
            setPreflightData(null)
            setPendingRoundId(null)
          }}
          onTopUp={() => router.push('/billing/topup')}
        />
      )}
    </div>
  )
}
