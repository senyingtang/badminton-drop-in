'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './my-matches.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export default function MyMatchesPage() {
  const supabase = createClient()
  const { user } = useUser()
  const [matches, setMatches] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [submittingMatchId, setSubmittingMatchId] = useState<string | null>(null)

  // Submissions state
  const [t1Score, setT1Score] = useState<{ [id: string]: number | '' }>({})
  const [t2Score, setT2Score] = useState<{ [id: string]: number | '' }>({})

  const fetchMyMatches = async () => {
    if (!user) return

    // 1. Get user's player ID
    const { data: pData } = await supabase
      .from('players')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!pData) {
      setLoading(false)
      return
    }

    const playerId = pData.id

    // 2. Fetch locked matches where I am a participant, that don't have a final score yet
    const { data, error } = await supabase
      .from('match_team_players')
      .select(`
        match_team_id,
        participant_id,
        session_participants!inner(player_id),
        match_teams!inner(
          team_no,
          matches!inner(
            id, match_label, final_score_team_1, final_score_team_2,
            rounds!inner(round_no, status, sessions!inner(id, title))
          )
        )
      `)
      .eq('session_participants.player_id', playerId)
      .eq('match_teams.matches.rounds.status', 'locked')
      .is('match_teams.matches.final_score_team_1', null)
      .order('id', { ascending: false, referencedTable: 'match_teams.matches' })

    if (error) {
      console.error(error)
      setLoading(false)
      return
    }

    const matchMap = new Map()
    for (const row of data || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchTeams: any = row.match_teams
      const match = Array.isArray(matchTeams) ? matchTeams[0].matches : matchTeams.matches
      if (match && !matchMap.has(match.id)) {
        matchMap.set(match.id, match)
      }
    }

    const uniqueMatches = Array.from(matchMap.values())

    // Fetch existing submissions for these matches to see if I already submitted
    for (const m of uniqueMatches) {
        // 欄位以正式 DB（docs/001）為準：submitted_by_player_id / score_team_1 / score_team_2
        const { data: sub } = await supabase
          .from('match_score_submissions')
          .select('score_team_1, score_team_2')
          .eq('match_id', m.id)
          .eq('submitted_by_player_id', playerId)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (sub) {
            m.mySubmission = sub
        }
    }

    setMatches(uniqueMatches)
    setLoading(false)
  }

  useEffect(() => {
    fetchMyMatches()
  }, [user, supabase])

  const handleSubmitScore = async (matchId: string) => {
    if (!user) return
    const s1 = t1Score[matchId]
    const s2 = t2Score[matchId]
    if (s1 === '' || s2 === '' || s1 === undefined || s2 === undefined) {
      alert('請輸入兩隊比分')
      return
    }

    setSubmittingMatchId(matchId)
    try {
      const { data: pData } = await supabase.from('players').select('id').eq('auth_user_id', user.id).single()
      if (!pData) throw new Error('Player not found')

      const { error } = await supabase.from('match_score_submissions').insert({
        match_id: matchId,
        submitted_by_player_id: pData.id,
        score_team_1: s1 as number,
        score_team_2: s2 as number,
      })

      if (error) throw error
      alert('回報成功！等待團主確認。')
      await fetchMyMatches()
    } catch (err) {
      console.error('Submit error:', err)
      alert('回報失敗')
    } finally {
      setSubmittingMatchId(null)
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>我的比賽與回報</h1>
        <p className={styles.sub}>您參與且正在進行中的比賽會顯示在此。比賽結束後，請協助回報比分。</p>
      </div>

      {matches.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📭</span>
          <p>目前沒有需要回報比分的比賽</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {matches.map((m) => (
            <div key={m.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.sessionName}>{m.rounds.sessions.title}</span>
                <span className={`badge badge-purple`}>
                  第 {m.rounds.round_no} 輪 - {m.match_label}
                </span>
              </div>
              
              {m.mySubmission ? (
                <div className={styles.submittedBox}>
                  <span className={styles.submittedIcon}>✅</span>
                  <div>
                    <div className={styles.submittedTitle}>您已回報比分</div>
                    <div className={styles.submittedVal}>
                      {m.mySubmission.score_team_1} : {m.mySubmission.score_team_2}
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.inputArea}>
                  <div className={styles.inputRow}>
                    <label>隊伍 1</label>
                    <input 
                      type="number" 
                      className="input" 
                      min={0} max={99}
                      value={t1Score[m.id] !== undefined ? t1Score[m.id] : ''}
                      onChange={(e) => setT1Score({ ...t1Score, [m.id]: e.target.value ? Number(e.target.value) : '' })}
                    />
                  </div>
                  <div className={styles.inputRow}>
                    <label>隊伍 2</label>
                    <input 
                      type="number" 
                      className="input" 
                      min={0} max={99}
                      value={t2Score[m.id] !== undefined ? t2Score[m.id] : ''}
                      onChange={(e) => setT2Score({ ...t2Score, [m.id]: e.target.value ? Number(e.target.value) : '' })}
                    />
                  </div>
                  <button 
                    className={`btn btn-primary ${styles.submitBtn}`}
                    onClick={() => handleSubmitScore(m.id)}
                    disabled={submittingMatchId === m.id}
                  >
                    {submittingMatchId === m.id ? '送出中...' : '送出比分'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
