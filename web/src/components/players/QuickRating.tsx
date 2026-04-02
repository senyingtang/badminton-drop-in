'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './QuickRating.module.css'

interface QuickRatingProps {
  playerId: string
  sessionId?: string
  onRated?: () => void
}

const quickOptions = [
  { code: 'great', label: '👍 好配合', icon: '👍', overall: 5, sportsmanship: 5, punctuality: null, comment: '好配合' },
  { code: 'on_time', label: '✅ 準時', icon: '✅', overall: 4, sportsmanship: null, punctuality: 5, comment: '準時出席' },
  { code: 'late_cancel', label: '⚠️ 臨時取消', icon: '⚠️', overall: 2, sportsmanship: null, punctuality: 1, comment: '臨時取消' },
  { code: 'no_show', label: '❌ 放鳥', icon: '❌', overall: 1, sportsmanship: null, punctuality: 1, comment: '未到場' },
]

export default function QuickRating({ playerId, sessionId, onRated }: QuickRatingProps) {
  const supabase = createClient()
  const { user } = useUser()
  const [loading, setLoading] = useState<string | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customForm, setCustomForm] = useState({
    overall: 3,
    punctuality: 3,
    sportsmanship: 3,
    comment: '',
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const submitRating = async (opts: {
    overall: number
    punctuality?: number | null
    sportsmanship?: number | null
    code?: string
    comment?: string
  }) => {
    if (!user) return
    setLoading(opts.code || 'custom')
    setMessage(null)

    const { error } = await supabase.from('player_ratings').insert({
      player_id: playerId,
      session_id: sessionId || null,
      rated_by_host_user_id: user.id,
      overall_score: opts.overall,
      punctuality_score: opts.punctuality || null,
      sportsmanship_score: opts.sportsmanship || null,
      quick_rating_code: opts.code || null,
      comment: opts.comment || null,
    })

    if (error) {
      setMessage({ type: 'error', text: '評價失敗：' + error.message })
    } else {
      setMessage({ type: 'success', text: '已送出評價！' })
      if (onRated) onRated()
    }
    setLoading(null)
  }

  const handleQuick = (opt: typeof quickOptions[0]) => {
    submitRating({
      overall: opt.overall,
      punctuality: opt.punctuality,
      sportsmanship: opt.sportsmanship,
      code: opt.code,
      comment: opt.comment,
    })
  }

  const handleCustomSubmit = () => {
    submitRating({
      overall: customForm.overall,
      punctuality: customForm.punctuality,
      sportsmanship: customForm.sportsmanship,
      comment: customForm.comment,
    })
    setShowCustom(false)
  }

  return (
    <div className={styles.container}>
      <h4 className={styles.title}>快捷評價</h4>

      <div className={styles.quickRow}>
        {quickOptions.map((opt) => (
          <button
            key={opt.code}
            className={styles.quickBtn}
            onClick={() => handleQuick(opt)}
            disabled={loading !== null}
          >
            <span className={styles.quickIcon}>{opt.icon}</span>
            <span className={styles.quickLabel}>{opt.label.split(' ')[1]}</span>
          </button>
        ))}
        <button
          className={`${styles.quickBtn} ${styles.customBtn}`}
          onClick={() => setShowCustom(!showCustom)}
          disabled={loading !== null}
        >
          <span className={styles.quickIcon}>⭐</span>
          <span className={styles.quickLabel}>自訂</span>
        </button>
      </div>

      {showCustom && (
        <div className={styles.customForm}>
          <div className={styles.customRow}>
            <label>總評 (1-5)</label>
            <input
              type="range" min={1} max={5} value={customForm.overall}
              onChange={(e) => setCustomForm({ ...customForm, overall: +e.target.value })}
            />
            <span className={styles.rangeValue}>{customForm.overall}</span>
          </div>
          <div className={styles.customRow}>
            <label>守時 (1-5)</label>
            <input
              type="range" min={1} max={5} value={customForm.punctuality}
              onChange={(e) => setCustomForm({ ...customForm, punctuality: +e.target.value })}
            />
            <span className={styles.rangeValue}>{customForm.punctuality}</span>
          </div>
          <div className={styles.customRow}>
            <label>精神 (1-5)</label>
            <input
              type="range" min={1} max={5} value={customForm.sportsmanship}
              onChange={(e) => setCustomForm({ ...customForm, sportsmanship: +e.target.value })}
            />
            <span className={styles.rangeValue}>{customForm.sportsmanship}</span>
          </div>
          <textarea
            className="input"
            placeholder="短評（選填）"
            rows={2}
            value={customForm.comment}
            onChange={(e) => setCustomForm({ ...customForm, comment: e.target.value })}
          />
          <button className="btn btn-primary btn-sm" onClick={handleCustomSubmit} disabled={loading !== null}>
            送出評價
          </button>
        </div>
      )}

      {message && (
        <div className={`${styles.message} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}
    </div>
  )
}
