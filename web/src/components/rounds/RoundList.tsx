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

type HostParticipantEnrichRow = {
  session_participant_id: string
  display_name: string | null
  session_effective_level: number | null
  self_level: number | null
  total_matches_played?: number
  consecutive_rounds_played?: number
  is_locked_for_current_round?: boolean
}

/**
 * 不要在 rounds 巢狀查詢裡 embed `players`：`players` 的 RLS 會呼叫
 * `user_can_access_player()`，其內部再查 `players`，可能造成 stack depth 遞迴。
 * RoundPanel 讀取 `session_participants.players.display_name` 與 `session_effective_level`；
 * 後者在 DB 常為 null（僅自評），需與 `list_session_participants_for_host` 一致做 coalesce。
 */
function sortRoundsForDisplay(rounds: RoundRow[]): RoundRow[] {
  return [...rounds].sort((a, b) => {
    if (b.round_no !== a.round_no) return b.round_no - a.round_no
    return (a.court_no ?? 1) - (b.court_no ?? 1)
  })
}

function courtLatestRound(rounds: RoundRow[], courtNo: number): RoundRow | null {
  const list = rounds.filter((r) => (r.court_no ?? 1) === courtNo)
  if (list.length === 0) return null
  return list.reduce((best, r) => (r.round_no > best.round_no ? r : best), list[0])
}

function courtCanScheduleNext(rounds: RoundRow[], courtNo: number): boolean {
  const latest = courtLatestRound(rounds, courtNo)
  if (!latest) return true
  return latest.status !== 'draft' && latest.status !== 'locked'
}

/** 依面場分欄：每欄內輪次由新到舊（第 N 輪大的在上） */
function groupRoundsByCourtList(
  rounds: RoundRow[],
  courtCount: number
): { courtNo: number; rounds: RoundRow[] }[] {
  const n = Math.max(1, courtCount)
  const cols: { courtNo: number; rounds: RoundRow[] }[] = []
  for (let cn = 1; cn <= n; cn++) {
    const list = rounds.filter((r) => (r.court_no ?? 1) === cn)
    list.sort((a, b) => b.round_no - a.round_no)
    cols.push({ courtNo: cn, rounds: list })
  }
  return cols
}

function buildAssignmentPayload(result: AssignmentResult, ruleSummary?: string) {
  return {
    rule_summary:
      ruleSummary ??
      `${result.assignments.length} courts, avg diff ${result.debugInfo.avgLevelDiff.toFixed(1)}`,
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
}

function enrichRoundsWithParticipantMeta(
  rounds: RoundRow[],
  metaByParticipantId: Map<string, HostParticipantEnrichRow>
): void {
  for (const r of rounds) {
    for (const m of r.matches || []) {
      for (const mt of m.match_teams || []) {
        for (const mtp of mt.match_team_players || []) {
          const sp = mtp.session_participants
          if (!sp?.id) continue
          const meta = metaByParticipantId.get(sp.id)
          if (!meta) continue
          const resolved =
            sp.session_effective_level ??
            meta.session_effective_level ??
            meta.self_level ??
            6
          sp.session_effective_level = resolved
          sp.self_level = meta.self_level
          sp.total_matches_played = meta.total_matches_played ?? sp.total_matches_played ?? 0
          sp.consecutive_rounds_played = meta.consecutive_rounds_played ?? sp.consecutive_rounds_played ?? 0
          sp.is_locked_for_current_round =
            meta.is_locked_for_current_round ?? sp.is_locked_for_current_round ?? false
          sp.players = {
            display_name: meta.display_name ?? sp.players?.display_name ?? null,
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

  // Assignment preview state（wave = 首輪一次建立全部面場；single = 單一面場下一輪）
  const [showPreview, setShowPreview] = useState(false)
  const [previewResult, setPreviewResult] = useState<AssignmentResult | null>(null)
  const [nextRoundNo, setNextRoundNo] = useState(1)
  const [previewMode, setPreviewMode] = useState<'wave' | 'single'>('single')
  const [previewCourtNo, setPreviewCourtNo] = useState<number | null>(null)
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
        .order('round_no', { ascending: true })
        .order('court_no', { ascending: true }),
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

    const metaMap = new Map<string, HostParticipantEnrichRow>()
    if (namesRes.data) {
      for (const row of namesRes.data as HostParticipantEnrichRow[]) {
        metaMap.set(row.session_participant_id, row)
      }
    }

    const nextRounds = sortRoundsForDisplay(structuredClone(data || []) as RoundRow[])
    enrichRoundsWithParticipantMeta(nextRounds, metaMap)
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

    type HostParticipantRow = HostParticipantEnrichRow & { status: string }

    const rows = data as HostParticipantRow[]
    return rows
      .filter((sp) => ['confirmed_main', 'promoted_from_waitlist'].includes(sp.status))
      .filter((sp) => !sp.is_locked_for_current_round)
      .map((sp) => ({
        participantId: sp.session_participant_id,
        displayName: sp.display_name || '未知',
        level: sp.session_effective_level || sp.self_level || 6,
        totalPlayed: Number(sp.total_matches_played ?? 0),
        consecutivePlayed: Number(sp.consecutive_rounds_played ?? 0),
      }))
  }

  const openFirstWavePreview = async () => {
    const players = await getAssignablePlayers()
    setPreviewMode('wave')
    setPreviewCourtNo(null)
    setNextRoundNo(1)
    setPreviewResult(generateAssignment(players, courtCount))
    setShowPreview(true)
  }

  const openNextRoundPreviewForCourt = async (courtNo: number) => {
    const players = await getAssignablePlayers()
    const forCourt = rounds.filter((r) => (r.court_no ?? 1) === courtNo)
    const maxR = forCourt.length > 0 ? Math.max(...forCourt.map((r) => r.round_no)) : 0
    const roundNo = maxR + 1
    setPreviewMode('single')
    setPreviewCourtNo(courtNo)
    setNextRoundNo(roundNo)
    const one = generateAssignment(players, 1)
    setPreviewResult({
      ...one,
      assignments: one.assignments.map((a) => ({ ...a, courtNo })),
    })
    setShowPreview(true)
  }

  const handleRegeneratePreview = useCallback(async () => {
    const players = await getAssignablePlayers()
    if (previewMode === 'wave') {
      setPreviewResult(generateAssignment(players, courtCount))
      return
    }
    if (previewCourtNo != null) {
      const one = generateAssignment(players, 1)
      setPreviewResult({
        ...one,
        assignments: one.assignments.map((a) => ({ ...a, courtNo: previewCourtNo })),
      })
    }
  }, [courtCount, previewCourtNo, previewMode, supabase])

  const handleConfirmAssignment = async (result: AssignmentResult) => {
    setActionLoading(true)
    try {
      const inputPayload = buildAssignmentPayload(result)

      if (previewMode === 'wave') {
        for (let cn = 1; cn <= courtCount; cn++) {
          if (!result.assignments.some((a) => a.courtNo === cn)) continue
          const { data: rawRoundId, error } = await supabase.rpc(
            'apply_assignment_recommendation_and_create_round',
            {
              input_session_id: sessionId,
              input_court_no: cn,
              input_round_no: 1,
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
        }
      } else {
        if (previewCourtNo == null) throw new Error('missing_court_no')
        const { data: rawRoundId, error } = await supabase.rpc(
          'apply_assignment_recommendation_and_create_round',
          {
            input_session_id: sessionId,
            input_court_no: previewCourtNo,
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
      }

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

  const handleLockRound = async (roundId: string) => {
    setActionLoading(true)
    const needsBillingPreflight = ['ready_for_assignment', 'assigned'].includes(sessionStatus)
    if (needsBillingPreflight) {
      try {
        const { data, error } = await supabase.rpc('kb_billing_preflight_session_start', {
          p_session_id: sessionId,
        })
        if (error) throw error

        if (data.consume_mode === 'already_consumed') {
          await executeLock(roundId)
        } else {
          setPreflightData(data)
          setPendingRoundId(roundId)
          setShowPreflight(true)
        }
      } catch (err) {
        console.error('Preflight error:', err)
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: string }).message)
            : '開打前計費檢查失敗'
        alert(
          `${msg}\n\n若訊息包含「No billing account」或計費帳戶，請在 Supabase 執行 docs/026_kb_resolve_billing_account_autocreate.sql 後再試。`
        )
      } finally {
        setActionLoading(false)
      }
    } else {
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
    const round = rounds.find((r) => r.id === roundId)
    const missing = (round?.matches || []).filter(
      (m: any) => m.final_score_team_1 == null || m.final_score_team_2 == null
    )
    if (missing.length > 0) {
      const labels = missing
        .map((m: any) => (m.match_label ? `${m.match_label}` : `${m.court_no ?? '?'}號場`))
        .slice(0, 6)
        .join('、')
      alert(`尚有未填比分的比賽：${labels}${missing.length > 6 ? '…' : ''}\n\n請先在該場卡片中填入比分後再結束本輪。`)
      return
    }

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

  const handleRebuildDraftRound = async (round: RoundRow) => {
    if (!confirm('確定要重新排組本輪？將刪除本輪草稿與分組，並重新產生。')) return
    setActionLoading(true)
    try {
      const { error } = await supabase.rpc('host_delete_draft_round', {
        input_round_id: round.id,
      })
      if (error) throw error
      await fetchRounds()
      onSessionRefresh()
      const cn = round.court_no ?? 1
      const rno = round.round_no
      const players = await getAssignablePlayers()
      setPreviewMode('single')
      setPreviewCourtNo(cn)
      setNextRoundNo(rno)
      const one = generateAssignment(players, 1)
      setPreviewResult({
        ...one,
        assignments: one.assignments.map((a) => ({ ...a, courtNo: cn })),
      })
      setShowPreview(true)
    } catch (err) {
      console.error('Rebuild failed:', err)
      alert('重新排組失敗，請稍後再試')
    } finally {
      setActionLoading(false)
    }
  }

  const scheduleStatusesOk = ['ready_for_assignment', 'assigned', 'in_progress', 'round_finished'].includes(
    sessionStatus
  )
  const canOpenFirstWave = scheduleStatusesOk && rounds.length === 0
  const courtActionRange = Array.from({ length: Math.max(1, courtCount) }, (_, i) => i + 1)

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
        {canOpenFirstWave && (
          <button
            className="btn btn-primary"
            onClick={() => void openFirstWavePreview()}
            disabled={actionLoading}
          >
            🎯 產生第一輪排組（全部面場）
          </button>
        )}
        {scheduleStatusesOk &&
          rounds.length > 0 &&
          courtActionRange.map((cn) =>
            courtCanScheduleNext(rounds, cn) ? (
              <button
                key={cn}
                className="btn btn-primary"
                type="button"
                onClick={() => void openNextRoundPreviewForCourt(cn)}
                disabled={actionLoading}
              >
                ➕ {cn} 號場排下一輪
              </button>
            ) : null
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
      <p className={styles.modelHint}>
        版面以<strong>面場</strong>為欄、欄內由上而下為該面場的第 1 輪、第 2 輪…（輪次較新的在上）。各面場可不同步鎖定／結束／排下一輪。首輪請用「產生第一輪排組（全部面場）」；系統排組會參考累積上場與連續上場，預覽內仍可手動換位後再確認。
      </p>

      {/* Rounds */}
      {rounds.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎯</span>
          <p>尚未建立排組</p>
          <p className={styles.emptyHint}>確認名單後即可開始產生排組</p>
        </div>
      ) : (
        <div className={styles.courtRows}>
          {groupRoundsByCourtList(rounds, courtCount).map(({ courtNo, rounds: colRounds }) => {
            const list = [...colRounds].sort((a, b) => b.round_no - a.round_no)
            return (
              <section key={courtNo} className={styles.courtRow}>
                <div className={styles.courtRowHeader}>
                  <h3 className={styles.courtRowTitle}>{courtNo} 號場</h3>
                  <span className={styles.courtRowHint}>可用滑鼠滾輪左右捲動查看各輪</span>
                </div>

                {list.length === 0 ? (
                  <p className={styles.courtColumnEmpty}>尚無此面場的輪次</p>
                ) : (
                  <div
                    className={styles.roundScroller}
                    onWheel={(e) => {
                      // 將垂直滾輪轉成水平捲動（不影響 trackpad 的水平捲動）
                      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
                      if (!d) return
                      ;(e.currentTarget as HTMLDivElement).scrollLeft += d
                      e.preventDefault()
                    }}
                  >
                    <div className={styles.roundStrip}>
                      {list.map((r) => (
                        <div key={r.id} className={styles.roundCard}>
                          <RoundPanel
                            round={r}
                            hideCourtInTitle
                            onLock={r.status === 'draft' ? () => handleLockRound(r.id) : undefined}
                            onUnlock={r.status === 'locked' ? () => handleUnlockRound(r.id) : undefined}
                            onRebuild={r.status === 'draft' ? () => handleRebuildDraftRound(r) : undefined}
                            onFinish={r.status === 'locked' ? () => handleFinishRound(r.id) : undefined}
                            onRefresh={fetchRounds}
                            actionLoading={actionLoading}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* Assignment Preview Modal */}
      {previewResult && (
        <AssignmentPreview
          isOpen={showPreview}
          onClose={() => {
            setShowPreview(false)
            setPreviewResult(null)
            setPreviewMode('single')
            setPreviewCourtNo(null)
          }}
          result={previewResult}
          roundNo={nextRoundNo}
          titleOverride={
            previewMode === 'wave'
              ? `第 1 輪排組預覽（${courtCount} 面場）`
              : previewCourtNo != null
                ? `第 ${nextRoundNo} 輪 · ${previewCourtNo} 號場排組預覽`
                : undefined
          }
          onConfirm={handleConfirmAssignment}
          onRegenerate={() => void handleRegeneratePreview()}
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
