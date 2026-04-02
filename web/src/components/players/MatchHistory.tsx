'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './MatchHistory.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

interface MatchHistoryProps {
  playerId: string
}

interface MatchHistoryItem {
  matchId: string
  sessionTitle: string
  date: string
  courtNo: number
  team: 'team1' | 'team2'
  partner: string
  opponents: string[]
  score1: number | null
  score2: number | null
  won: boolean | null
}

export default function MatchHistory({ playerId }: MatchHistoryProps) {
  const supabase = createClient()
  const [matches, setMatches] = useState<MatchHistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      // Get participant IDs for this player
      const { data: participants } = await supabase
        .from('session_participants')
        .select('id, session_id, sessions(title, start_at)')
        .eq('player_id', playerId)

      if (!participants || participants.length === 0) {
        setLoading(false)
        return
      }

      const participantIds = participants.map((p: Row) => p.id)

      // Get match_team_players for these participants
      const { data: mtps } = await supabase
        .from('match_team_players')
        .select(`
          participant_id,
          match_teams(
            team_no,
            match_id,
            matches(
              id, court_no, final_score_team_1, final_score_team_2, winning_team_no,
              rounds(round_no, session_id)
            )
          )
        `)
        .in('participant_id', participantIds)

      if (!mtps) {
        setLoading(false)
        return
      }

      const items: MatchHistoryItem[] = []

      for (const mtp of mtps) {
        const mt = mtp.match_teams as Row
        if (!mt?.matches) continue
        const match = mt.matches as Row
        const round = match.rounds as Row
        if (!round) continue

        // Find session info
        const sessionInfo = participants.find((p: Row) => p.session_id === round.session_id)
        if (!sessionInfo) continue

        const teamNo = mt.team_no as number

        items.push({
          matchId: match.id,
          sessionTitle: (sessionInfo.sessions as Row)?.title || '',
          date: (sessionInfo.sessions as Row)?.start_at || '',
          courtNo: match.court_no,
          team: teamNo === 1 ? 'team1' : 'team2',
          partner: '', // Could be enriched later
          opponents: [],
          score1: match.final_score_team_1,
          score2: match.final_score_team_2,
          won: match.winning_team_no != null ? match.winning_team_no === teamNo : null,
        })
      }

      // Sort by date descending
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      setMatches(items.slice(0, 20))
      setLoading(false)
    }

    fetch()
  }, [playerId, supabase])

  if (loading) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>
  }

  if (matches.length === 0) {
    return (
      <div className={styles.empty}>
        <p>目前沒有對戰紀錄</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <h4 className={styles.title}>歷史對戰 (近 {matches.length} 場)</h4>
      <div className={styles.list}>
        {matches.map((m, i) => (
          <div key={`${m.matchId}-${i}`} className={styles.item}>
            <div className={styles.itemLeft}>
              <span className={`${styles.result} ${m.won === true ? styles.won : m.won === false ? styles.lost : ''}`}>
                {m.won === true ? 'W' : m.won === false ? 'L' : '—'}
              </span>
              <div className={styles.itemInfo}>
                <span className={styles.itemSession}>{m.sessionTitle}</span>
                <span className={styles.itemDate}>
                  {m.date ? new Date(m.date).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' }) : ''}
                  {' · '}{m.courtNo}號場
                </span>
              </div>
            </div>
            <div className={styles.itemScore}>
              {m.score1 != null && m.score2 != null ? (
                <span>{m.score1} : {m.score2}</span>
              ) : (
                <span className={styles.noScore}>未記分</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
