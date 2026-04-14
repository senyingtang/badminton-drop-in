'use client'

import MatchCard from './MatchCard'
import styles from './RoundPanel.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoundData = any

interface RoundPanelProps {
  round: RoundData
  onLock?: () => void
  onUnlock?: () => void
  onRebuild?: () => void
  onFinish?: () => void
  onRefresh?: () => void
  actionLoading?: boolean
}

const roundStatusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'blue' },
  locked: { label: '比賽中', color: 'green' },
  finished: { label: '已完成', color: 'purple' },
  cancelled: { label: '已取消', color: 'red' },
}

export default function RoundPanel({ round, onLock, onUnlock, onRebuild, onFinish, onRefresh, actionLoading }: RoundPanelProps) {
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
      }))
    }

    return {
      matchId: m.id,
      courtNo: m.court_no,
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
          <h3 className={styles.roundTitle}>第 {round.round_no} 輪</h3>
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
