'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateShareSignupCode } from '@/lib/share-signup-code'
import { useUser } from '@/hooks/useUser'
import styles from './CreateSessionForm.module.css'

interface Venue {
  id: string
  name: string
}

export default function CreateSessionForm() {
  const router = useRouter()
  const supabase = createClient()
  const { user } = useUser()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [courtCount, setCourtCount] = useState(2)
  const [assignmentMode, setAssignmentMode] = useState('rotation_fair')
  const [allowSelfSignup, setAllowSelfSignup] = useState(false)
  const [maxParticipants, setMaxParticipants] = useState(24)
  const [feeTwd, setFeeTwd] = useState(0)

  // Venue
  const [venues, setVenues] = useState<Venue[]>([])
  const [selectedVenueId, setSelectedVenueId] = useState<string>('')
  const [showNewVenue, setShowNewVenue] = useState(false)
  const [newVenueName, setNewVenueName] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch user's venues
  useEffect(() => {
    if (!user) return

    const fetchVenues = async () => {
      // Venues owned by user
      const { data: owned } = await supabase
        .from('venues')
        .select('id, name')
        .eq('owner_user_id', user.id)
        .eq('is_active', true)

      // Venues user has membership to
      const { data: memberships } = await supabase
        .from('venue_host_memberships')
        .select('venues(id, name)')
        .eq('host_user_id', user.id)
        .eq('is_active', true)

      const memberVenues = (memberships || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => m.venues)
        .filter(Boolean)

      const allVenues = [...(owned || []), ...memberVenues]
      // Deduplicate
      const unique = allVenues.filter(
        (v, i, arr) => arr.findIndex((a) => a.id === v.id) === i
      )
      setVenues(unique)
    }

    fetchVenues()
  }, [user, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      let venueId: string | null = selectedVenueId || null

      // Create new venue if needed
      if (showNewVenue && newVenueName.trim()) {
        const { data: newVenue, error: venueError } = await supabase
          .from('venues')
          .insert({
            owner_user_id: user.id,
            name: newVenueName.trim(),
          })
          .select('id')
          .single()

        if (venueError) throw venueError
        venueId = newVenue.id
      }

      let session: { id: string } | null = null
      let sessionError: Error | null = null

      for (let attempt = 0; attempt < 5; attempt++) {
        const shareCode = allowSelfSignup ? generateShareSignupCode() : null
        const res = await supabase
          .from('sessions')
          .insert({
            title: title.trim(),
            description: description.trim() || null,
            venue_id: venueId,
            host_user_id: user.id,
            created_by_user_id: user.id,
            start_at: new Date(startAt).toISOString(),
            end_at: new Date(endAt).toISOString(),
            court_count: courtCount,
            assignment_mode: assignmentMode,
            allow_self_signup: allowSelfSignup,
            share_signup_code: shareCode,
            max_participants: maxParticipants,
            fee_twd: feeTwd,
            status: 'draft',
            metadata: {
              max_participants: maxParticipants,
              fee_twd: feeTwd,
            },
          })
          .select('id')
          .single()

        session = res.data
        sessionError = res.error as Error | null
        if (!sessionError) break
        if ((sessionError as { code?: string }).code !== '23505') break
      }

      if (sessionError) throw sessionError
      if (!session) throw new Error('建立場次失敗')
      router.push(`/sessions/${session.id}`)
    } catch (err: any) {
      console.error('Session creation error:', err)
      setError(err?.message || JSON.stringify(err) || '建立失敗，請重試')
      setLoading(false)
    }
  }

  // Auto-set default end time (2 hours after start)
  const handleStartChange = (val: string) => {
    setStartAt(val)
    if (val && !endAt) {
      const d = new Date(val)
      d.setHours(d.getHours() + 2)
      const pad = (n: number) => String(n).padStart(2, '0')
      setEndAt(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      )
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && <div className={styles.error}>{error}</div>}

      {/* Title */}
      <div className={styles.field}>
        <label htmlFor="title">場次標題 *</label>
        <input
          id="title"
          type="text"
          className="input"
          placeholder="例：週三晚間臨打"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      {/* Description */}
      <div className={styles.field}>
        <label htmlFor="description">說明</label>
        <textarea
          id="description"
          className={`input ${styles.textarea}`}
          placeholder="場次說明（選填）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      {/* Venue */}
      <div className={styles.field}>
        <label>場館</label>
        {!showNewVenue ? (
          <div className={styles.venueRow}>
            <select
              className={`input ${styles.select}`}
              value={selectedVenueId}
              onChange={(e) => setSelectedVenueId(e.target.value)}
            >
              <option value="">不指定場館</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <button
              type="button"
              className={`btn btn-ghost ${styles.addVenueBtn}`}
              onClick={() => setShowNewVenue(true)}
            >
              ＋ 新增
            </button>
          </div>
        ) : (
          <div className={styles.newVenueRow}>
            <input
              type="text"
              className="input"
              placeholder="輸入場館名稱"
              value={newVenueName}
              onChange={(e) => setNewVenueName(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowNewVenue(false)
                setNewVenueName('')
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* Date/Time */}
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="startAt">開始時間 *</label>
          <input
            id="startAt"
            type="datetime-local"
            className="input"
            value={startAt}
            onChange={(e) => handleStartChange(e.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="endAt">結束時間 *</label>
          <input
            id="endAt"
            type="datetime-local"
            className="input"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Court Count + Mode */}
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="courtCount">場地數量 *</label>
          <input
            id="courtCount"
            type="number"
            className="input"
            min={1}
            max={20}
            value={courtCount}
            onChange={(e) => setCourtCount(Number(e.target.value))}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="assignmentMode">排組模式</label>
          <select
            id="assignmentMode"
            className={`input ${styles.select}`}
            value={assignmentMode}
            onChange={(e) => setAssignmentMode(e.target.value)}
          >
            <option value="rotation_fair">輪轉公平</option>
            <option value="hybrid">混合</option>
            <option value="custom">自訂</option>
          </select>
        </div>
      </div>

      {/* Self Signup Toggle */}
      <div className={styles.toggleRow}>
        <div className={styles.toggleInfo}>
          <label>允許球員自行報名</label>
          <span className={styles.toggleHint}>開啟後會產生報名分享連結</span>
        </div>
        <button
          type="button"
          className={`${styles.toggle} ${allowSelfSignup ? styles.toggleOn : ''}`}
          onClick={() => setAllowSelfSignup(!allowSelfSignup)}
          role="switch"
          aria-checked={allowSelfSignup}
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>

      {/* New Fields for Phase 6 */}
      {allowSelfSignup && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="maxParticipants">人數上限 (含正選)</label>
            <input
              id="maxParticipants"
              type="number"
              className="input"
              min={1}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(Number(e.target.value))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="feeTwd">報名費用 (NT$)</label>
            <input
              id="feeTwd"
              type="number"
              className="input"
              min={0}
              value={feeTwd}
              onChange={(e) => setFeeTwd(Number(e.target.value))}
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.back()}
        >
          取消
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
          {loading ? '建立中...' : '建立場次'}
        </button>
      </div>
    </form>
  )
}
