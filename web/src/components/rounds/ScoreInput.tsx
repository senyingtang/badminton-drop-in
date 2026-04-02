'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './ScoreInput.module.css'

interface ScoreInputProps {
  matchId: string
  onSubmitted: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submissions?: any[]
}

export default function ScoreInput({ matchId, onSubmitted, submissions }: ScoreInputProps) {
  const supabase = createClient()
  const [score1, setScore1] = useState('')
  const [score2, setScore2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (overrideS1?: number, overrideS2?: number) => {
    const s1Value = overrideS1 !== undefined ? overrideS1 : parseInt(score1)
    const s2Value = overrideS2 !== undefined ? overrideS2 : parseInt(score2)

    if (isNaN(s1Value) || isNaN(s2Value) || s1Value < 0 || s2Value < 0) {
      setError('請輸入有效比分')
      return
    }

    if (s1Value === s2Value) {
      setError('比分不得相同')
      return
    }

    setLoading(true)
    setError(null)

    const winningTeam = s1Value > s2Value ? 1 : 2

    const { error: err } = await supabase
      .from('matches')
      .update({
        final_score_team_1: s1Value,
        final_score_team_2: s2Value,
        winning_team_no: winningTeam,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', matchId)

    if (err) {
      setError('更新失敗：' + err.message)
    } else {
      // If there are submissions, mark them as adopted
      if (submissions && submissions.length > 0) {
          await supabase.from('match_score_submissions').update({ is_adopted: true, status: 'adopted' }).eq('match_id', matchId)
      }
      onSubmitted()
    }
    setLoading(false)
  }

  return (
    <div className={styles.container}>
      <div className={styles.inputs}>
        <input
          type="number"
          className={styles.scoreField}
          placeholder="T1"
          min={0}
          value={score1}
          onChange={(e) => setScore1(e.target.value)}
        />
        <span className={styles.colon}>:</span>
        <input
          type="number"
          className={styles.scoreField}
          placeholder="T2"
          min={0}
          value={score2}
          onChange={(e) => setScore2(e.target.value)}
        />
        <button
          className={styles.confirmBtn}
          onClick={() => handleSubmit()}
          disabled={loading || !score1 || !score2}
        >
          {loading ? '...' : '✓'}
        </button>
      </div>
      {error && <span className={styles.error}>{error}</span>}
      
      {submissions && submissions.length > 0 && (
        <div className={styles.submissions}>
          <span className={styles.subtext}>球員回報：{submissions[0].team1_score}:{submissions[0].team2_score}</span>
          <button 
            className={`btn btn-ghost btn-sm ${styles.adoptBtn}`}
            onClick={() => handleSubmit(submissions[0].team1_score, submissions[0].team2_score)}
            disabled={loading}
          >
            一鍵採納
          </button>
        </div>
      )}
    </div>
  )
}
