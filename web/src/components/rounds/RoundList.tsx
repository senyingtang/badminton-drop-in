'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generateAssignment, AssignmentResult, AssignablePlayer } from '@/lib/engine/assignment-engine'
import RoundPanel from './RoundPanel'
import { useRouter } from 'next/navigation'
import AssignmentPreview from './AssignmentPreview'
import BillingPreflightDialog from '../billing/BillingPreflightDialog'
import styles from './RoundList.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoundRow = any

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

  const fetchRounds = useCallback(async () => {
    const { data } = await supabase
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
              session_participants:participant_id(
                id,
                session_effective_level,
                players(display_name)
              )
            )
          )
        )
      `)
      .eq('session_id', sessionId)
      .order('round_no', { ascending: true })

    setRounds(data || [])
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

    const rows = data as any[]
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
      // 1. Insert assignment_recommendation
      const { data: rec } = await supabase
        .from('assignment_recommendations')
        .insert({
          session_id: sessionId,
          round_no: nextRoundNo,
          status: 'applied',
          source: 'rule_engine',
          rule_summary: `${result.assignments.length} courts, avg diff ${result.debugInfo.avgLevelDiff.toFixed(1)}`,
          debug_payload: result.debugInfo,
        })
        .select('id')
        .single()

      if (!rec) throw new Error('Failed to create recommendation')

      // 2. Insert recommendation items
      const recItems = result.assignments.flatMap((a) => [
        ...a.team1.map((p) => ({
          recommendation_id: rec.id,
          court_no: a.courtNo,
          team_no: 1,
          participant_id: p.participantId,
        })),
        ...a.team2.map((p) => ({
          recommendation_id: rec.id,
          court_no: a.courtNo,
          team_no: 2,
          participant_id: p.participantId,
        })),
      ])

      await supabase.from('assignment_recommendation_items').insert(recItems)

      // 3. Insert round
      const { data: round } = await supabase
        .from('rounds')
        .insert({
          session_id: sessionId,
          round_no: nextRoundNo,
          status: 'draft',
          recommendation_id: rec.id,
        })
        .select('id')
        .single()

      if (!round) throw new Error('Failed to create round')

      // 4. Insert matches, match_teams, match_team_players
      for (const a of result.assignments) {
        const matchLabel = `R${nextRoundNo}-C${a.courtNo}`
        const { data: match } = await supabase
          .from('matches')
          .insert({
            session_id: sessionId,
            round_id: round.id,
            court_no: a.courtNo,
            match_label: matchLabel,
          })
          .select('id')
          .single()

        if (!match) continue

        // Team 1
        const { data: t1 } = await supabase
          .from('match_teams')
          .insert({ match_id: match.id, team_no: 1 })
          .select('id')
          .single()

        if (t1) {
          await supabase.from('match_team_players').insert(
            a.team1.map((p) => ({ match_team_id: t1.id, participant_id: p.participantId }))
          )
        }

        // Team 2
        const { data: t2 } = await supabase
          .from('match_teams')
          .insert({ match_id: match.id, team_no: 2 })
          .select('id')
          .single()

        if (t2) {
          await supabase.from('match_team_players').insert(
            a.team2.map((p) => ({ match_team_id: t2.id, participant_id: p.participantId }))
          )
        }
      }

      setShowPreview(false)
      setPreviewResult(null)
      await fetchRounds()
    } catch (err) {
      console.error('Failed to confirm assignment:', err)
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
    ['ready_for_assignment', 'round_finished'].includes(sessionStatus) && !hasDraftRound && !hasLockedRound

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
