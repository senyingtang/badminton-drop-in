'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './ScoreInput.module.css'

interface ScoreInputProps {
  matchId: string
  onSubmitted: () => void
  initialScore1?: number | null
  initialScore2?: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submissions?: any[]
}

export default function ScoreInput({ matchId, onSubmitted, initialScore1, initialScore2, submissions }: ScoreInputProps) {
  const supabase = createClient()
  const [score1, setScore1] = useState(initialScore1 != null ? String(initialScore1) : '')
  const [score2, setScore2] = useState(initialScore2 != null ? String(initialScore2) : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 最新一筆「待採納」的球員回報（欄位以正式 DB 為準：score_team_1 / score_team_2 / status / submitted_at）
  const pending = (submissions || [])
    .filter((x) => x && x.status === 'submitted')
    .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))[0] as
    | { score_team_1: number; score_team_2: number }
    | undefined

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
    const { data: au } = await supabase.auth.getUser()
    const userId = au?.user?.id || null

    const { error: err } = await supabase
      .from('matches')
      .update({
        final_score_team_1: s1Value,
        final_score_team_2: s2Value,
        winning_team_no: winningTeam,
        confirmed_by_user_id: userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', matchId)

    if (err) {
      setError('更新失敗：' + err.message)
    } else {
      // 有球員回報：標記為已採納（enum score_submission_status_type：submitted / confirmed / rejected）
      if (pending) {
        await supabase
          .from('match_score_submissions')
          .update({ status: 'confirmed', reviewed_by_user_id: userId, reviewed_at: new Date().toISOString() })
          .eq('match_id', matchId)
          .eq('status', 'submitted')
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
      
      {pending && (
        <div className={styles.submissions}>
          <span className={styles.subtext}>球員回報：{pending.score_team_1}:{pending.score_team_2}</span>
          <button 
            className={`btn btn-ghost btn-sm ${styles.adoptBtn}`}
            onClick={() => handleSubmit(Number(pending.score_team_1), Number(pending.score_team_2))}
            disabled={loading}
          >
            一鍵採納
          </button>
        </div>
      )}
    </div>
  )
}
