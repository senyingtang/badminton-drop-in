'use client'

import MatchCard from './MatchCard'
import { type SessionCourtSlot, formatCourtSlotTitle } from '@/lib/session-court-slots'
import styles from './RoundPanel.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoundData = any

interface RoundPanelProps {
  round: RoundData
  /** 外層已依面場分欄時，標題不重複顯示「· N 號場」 */
  hideCourtInTitle?: boolean
  courtSlot?: SessionCourtSlot | null
  onLock?: () => void
  onUnlock?: () => void
  onRebuild?: () => void
  onDeleteDraft?: () => void
  onFinish?: () => void
  onRefresh?: () => void
  actionLoading?: boolean
}

const roundStatusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: '下一排組／草稿', color: 'blue' },
  locked: { label: '進行中／已鎖定', color: 'green' },
  finished: { label: '已完成', color: 'purple' },
  cancelled: { label: '已取消', color: 'red' },
}

export default function RoundPanel({
  round,
  hideCourtInTitle,
  courtSlot,
  onLock,
  onUnlock,
  onRebuild,
  onDeleteDraft,
  onFinish,
  onRefresh,
  actionLoading,
}: RoundPanelProps) {
  const statusInfo = roundStatusLabels[round.status] || { label: round.status, color: 'gray' }
  const matches = round.matches || []

  // Build match data from nested relations
  const matchCards = matches.map((m: RoundData) => {
    const teams = m.match_teams || []
    const team1Data = teams.find((t: RoundData) => t.team_no === 1)
    const team2Data = teams.find((t: RoundData) => t.team_no === 2)

    const mapPlayers = (teamData: RoundData) => {
      if (!teamData?.match_team_players) return []
      return teamData.match_team_players.map((mtp: RoundData) => ({
        participantId: mtp.participant_id,
        displayName: mtp.session_participants?.players?.display_name || '未知',
        level:
          mtp.session_participants?.session_effective_level ??
          mtp.session_participants?.self_level ??
          6,
        sessionTotalPlayed: mtp.session_participants?.total_matches_played ?? undefined,
      }))
    }

    const courtTitle = courtSlot ? formatCourtSlotTitle(courtSlot) : `${m.court_no} 號場`

    return {
      matchId: m.id,
      courtNo: m.court_no,
      courtTitle,
      matchLabel: m.match_label,
      team1: mapPlayers(team1Data),
      team2: mapPlayers(team2Data),
      scoreTeam1: m.final_score_team_1,
      scoreTeam2: m.final_score_team_2,
      winningTeamNo: m.winning_team_no,
      submissions: m.match_score_submissions || [],
    }
  })

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.roundTitle}>
            第 {round.round_no} 輪
            {!hideCourtInTitle
              ? courtSlot
                ? ` · ${formatCourtSlotTitle(courtSlot)}`
                : round.court_no != null
                  ? ` · ${round.court_no} 號場`
                  : ''
              : ''}
          </h3>
          <span className={`${styles.badge} ${styles[statusInfo.color]}`}>
            {statusInfo.label}
          </span>
        </div>
        <div className={styles.headerRight}>
          {round.status === 'draft' && onLock && (
            <button
              className="btn btn-primary btn-sm"
              onClick={onLock}
              disabled={actionLoading}
            >
              🔒 鎖定開打
            </button>
          )}
          {round.status === 'draft' && onRebuild && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onRebuild}
              disabled={actionLoading}
              title="刪除本輪草稿並重新排組"
            >
              ♻ 重新排組
            </button>
          )}
          {round.status === 'draft' && onDeleteDraft && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onDeleteDraft}
              disabled={actionLoading}
              type="button"
              title="刪除此輪草稿"
            >
              🗑 刪除草稿
            </button>
          )}
          {round.status === 'locked' && onUnlock && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onUnlock}
              disabled={actionLoading}
              title="解除鎖定（回到草稿，可重新調整排組）"
            >
              🔓 解鎖
            </button>
          )}
          {round.status === 'locked' && onFinish && (
            <button
              className="btn btn-primary btn-sm"
              onClick={onFinish}
              disabled={actionLoading}
            >
              ✓ 結束本輪
            </button>
          )}
        </div>
      </div>

      <div className={styles.matchGrid}>
        {matchCards.map((mc: RoundData) => (
          <MatchCard
            key={mc.matchId}
            matchId={mc.matchId}
            courtNo={mc.courtNo}
            courtTitle={mc.courtTitle}
            matchLabel={mc.matchLabel}
            team1={mc.team1}
            team2={mc.team2}
            status={round.status}
            scoreTeam1={mc.scoreTeam1}
            scoreTeam2={mc.scoreTeam2}
            winningTeamNo={mc.winningTeamNo}
            submissions={mc.submissions}
            onScoreSubmit={onRefresh}
          />
        ))}
      </div>

      {round.locked_at && (
        <div className={styles.timestamp}>
          🔒 鎖定於 {new Date(round.locked_at).toLocaleTimeString('zh-TW')}
        </div>
      )}
      {round.finished_at && (
        <div className={styles.timestamp}>
          ✓ 完成於 {new Date(round.finished_at).toLocaleTimeString('zh-TW')}
        </div>
      )}
    </div>
  )
}
