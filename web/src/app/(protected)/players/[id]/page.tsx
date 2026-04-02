'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import QuickRating from '@/components/players/QuickRating'
import MatchHistory from '@/components/players/MatchHistory'
import styles from './player-detail.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export default function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: playerId } = use(params)
  const supabase = createClient()
  const { user } = useUser()

  const [player, setPlayer] = useState<Row | null>(null)
  const [hpp, setHpp] = useState<Row | null>(null)
  const [ratingSummary, setRatingSummary] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)

  // Editable fields
  const [editLevel, setEditLevel] = useState<string>('')
  const [editNote, setEditNote] = useState('')
  const [editWarning, setEditWarning] = useState('normal')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    const fetchData = async () => {
      setLoading(true)

      // Player
      const { data: p } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single()
      setPlayer(p)

      // Host player profile
      const { data: h } = await supabase
        .from('host_player_profiles')
        .select('*')
        .eq('player_id', playerId)
        .eq('host_user_id', user.id)
        .single()
      setHpp(h)
      if (h) {
        setEditLevel(h.host_confirmed_level?.toString() || '')
        setEditNote(h.private_note || '')
        setEditWarning(h.warning_status || 'normal')
      }

      // Rating summary
      const { data: rs } = await supabase
        .from('player_rating_summary')
        .select('*')
        .eq('player_id', playerId)
        .single()
      setRatingSummary(rs)

      setLoading(false)
    }

    fetchData()
  }, [playerId, user, supabase])

  const handleSave = async () => {
    if (!hpp) return
    setSaving(true)
    setSaveMsg(null)

    const level = editLevel ? parseInt(editLevel) : null
    const { error } = await supabase
      .from('host_player_profiles')
      .update({
        host_confirmed_level: level,
        private_note: editNote,
        warning_status: editWarning,
      })
      .eq('id', hpp.id)

    if (error) {
      setSaveMsg('儲存失敗')
    } else {
      setSaveMsg('已儲存')
      setTimeout(() => setSaveMsg(null), 2000)
    }
    setSaving(false)
  }

  const refreshRating = async () => {
    const { data } = await supabase
      .from('player_rating_summary')
      .select('*')
      .eq('player_id', playerId)
      .single()
    setRatingSummary(data)
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入球員資料...</p>
      </div>
    )
  }

  if (!player) {
    return (
      <div className={styles.notFound}>
        <h3>找不到此球員</h3>
        <Link href="/players" className="btn btn-ghost">返回球員名單</Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/players" className={styles.backLink}>← 返回</Link>
        <div className={styles.headerInfo}>
          <div className={styles.avatar}>{player.display_name?.charAt(0)}</div>
          <div>
            <h1 className={styles.title}>{player.display_name}</h1>
            <span className={styles.code}>{player.player_code}</span>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {/* Left: Profile info */}
        <div className={styles.left}>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>基本資訊</h3>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>性別</label>
                <span>{player.gender === 'male' ? '男' : player.gender === 'female' ? '女' : '未設定'}</span>
              </div>
              <div className={styles.field}>
                <label>慣用手</label>
                <span>{player.handedness === 'right' ? '右手' : player.handedness === 'left' ? '左手' : '未設定'}</span>
              </div>
              <div className={styles.field}>
                <label>自填級數</label>
                <span>{hpp?.self_level ?? '—'}</span>
              </div>
              <div className={styles.field}>
                <label>年齡</label>
                <span>{player.age ?? '未設定'}</span>
              </div>
            </div>
          </div>

          {hpp && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>團主設定</h3>
              <div className={styles.formFields}>
                <div className={styles.formField}>
                  <label>確認級數 (1-18)</label>
                  <input
                    type="number"
                    className="input"
                    min={1} max={18}
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value)}
                    placeholder="未確認"
                  />
                </div>
                <div className={styles.formField}>
                  <label>警示狀態</label>
                  <select
                    className="input"
                    value={editWarning}
                    onChange={(e) => setEditWarning(e.target.value)}
                  >
                    <option value="normal">正常</option>
                    <option value="warned">⚠ 警示</option>
                    <option value="blacklisted">🚫 黑名單</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>私有備註</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    placeholder="團主專用備註，僅自己可見..."
                  />
                </div>
                <div className={styles.formActions}>
                  <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                    {saving ? '儲存中...' : '儲存變更'}
                  </button>
                  {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Rating summary */}
          {ratingSummary && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>評價彙總</h3>
              <div className={styles.ratingGrid}>
                <div className={styles.ratingItem}>
                  <span className={styles.ratingValue}>{ratingSummary.overall_avg || '—'}</span>
                  <span className={styles.ratingLabel}>總評</span>
                </div>
                <div className={styles.ratingItem}>
                  <span className={styles.ratingValue}>{ratingSummary.punctuality_avg || '—'}</span>
                  <span className={styles.ratingLabel}>守時</span>
                </div>
                <div className={styles.ratingItem}>
                  <span className={styles.ratingValue}>{ratingSummary.sportsmanship_avg || '—'}</span>
                  <span className={styles.ratingLabel}>精神</span>
                </div>
                <div className={styles.ratingItem}>
                  <span className={styles.ratingValue}>{ratingSummary.rating_count || 0}</span>
                  <span className={styles.ratingLabel}>筆數</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Rating + History */}
        <div className={styles.right}>
          <QuickRating playerId={playerId} onRated={refreshRating} />
          <MatchHistory playerId={playerId} />
        </div>
      </div>
    </div>
  )
}
