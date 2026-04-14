'use client'

import ScoreInput from './ScoreInput'
import styles from './MatchCard.module.css'

interface Player {
  participantId: string
  displayName: string
  level: number
  /** 本場次累積上場場次（選填，例如排組預覽） */
  sessionTotalPlayed?: number
}

interface MatchCardProps {
  courtNo: number
  matchLabel: string
  matchId?: string
  team1: Player[]
  team2: Player[]
  status: 'draft' | 'locked' | 'finished'
  scoreTeam1?: number | null
  scoreTeam2?: number | null
  winningTeamNo?: number | null
  selectedPlayerId?: string | null
  onPlayerClick?: (participantId: string) => void
  onScoreSubmit?: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submissions?: any[]
}

export default function MatchCard({
  courtNo,
  matchLabel,
  matchId,
  team1,
  team2,
  status,
  scoreTeam1,
  scoreTeam2,
  winningTeamNo,
  selectedPlayerId,
  onPlayerClick,
  onScoreSubmit,
  submissions,
}: MatchCardProps) {
  const t1Level = team1.reduce((s, p) => s + p.level, 0)
  const t2Level = team2.reduce((s, p) => s + p.level, 0)
  const diff = Math.abs(t1Level - t2Level)

  const hasScore = scoreTeam1 != null && scoreTeam2 != null
  const showScoreInput = status === 'locked' && !hasScore && matchId && onScoreSubmit

  return (
    <div className={`${styles.card} ${styles[status]}`}>
      <div className={styles.header}>
        <span className={styles.court}>{courtNo}號場</span>
        <span className={styles.label}>{matchLabel}</span>
        {diff > 0 && <span className={styles.diff}>±{diff}</span>}
      </div>

      <div className={styles.matchArea}>
        {/* Team 1 */}
        <div className={`${styles.team} ${winningTeamNo === 1 ? styles.winner : ''}`}>
          <div className={styles.teamLabel}>Team 1 {winningTeamNo === 1 && '🏆'}</div>
          <div className={styles.teamSum}>Lv.{t1Level}</div>
          {team1.map((p) => (
            <button
              key={p.participantId}
              className={`${styles.player} ${selectedPlayerId === p.participantId ? styles.selected : ''}`}
              onClick={() => onPlayerClick?.(p.participantId)}
              disabled={!onPlayerClick}
              type="button"
            >
              <span className={styles.playerName}>{p.displayName}</span>
              <span className={styles.playerLevel}>
                Lv.{p.level}
                {typeof p.sessionTotalPlayed === 'number' && (
                  <span className={styles.playCount}> · {p.sessionTotalPlayed}場</span>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* VS / Score */}
        <div className={styles.vs}>
          {hasScore ? (
            <div className={styles.score}>
              <span className={winningTeamNo === 1 ? styles.winScore : ''}>{scoreTeam1}</span>
              <span className={styles.scoreSep}>:</span>
              <span className={winningTeamNo === 2 ? styles.winScore : ''}>{scoreTeam2}</span>
            </div>
          ) : showScoreInput ? (
            <ScoreInput matchId={matchId} onSubmitted={onScoreSubmit} submissions={submissions} />
          ) : (
            <span>VS</span>
          )}
        </div>

        {/* Team 2 */}
        <div className={`${styles.team} ${winningTeamNo === 2 ? styles.winner : ''}`}>
          <div className={styles.teamLabel}>Team 2 {winningTeamNo === 2 && '🏆'}</div>
          <div className={styles.teamSum}>Lv.{t2Level}</div>
          {team2.map((p) => (
            <button
              key={p.participantId}
              className={`${styles.player} ${selectedPlayerId === p.participantId ? styles.selected : ''}`}
              onClick={() => onPlayerClick?.(p.participantId)}
              disabled={!onPlayerClick}
              type="button"
            >
              <span className={styles.playerName}>{p.displayName}</span>
              <span className={styles.playerLevel}>
                Lv.{p.level}
                {typeof p.sessionTotalPlayed === 'number' && (
                  <span className={styles.playCount}> · {p.sessionTotalPlayed}場</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
