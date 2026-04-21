'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateShareSignupCode } from '@/lib/share-signup-code'
import { useUser } from '@/hooks/useUser'
import {
  DEFAULT_SHUTTLECOCK_TYPE,
  SHUTTLECOCK_BRAND_MAX_LENGTH,
  SHUTTLECOCK_OPTIONS,
  type ShuttlecockTypeId,
} from '@/lib/shuttlecock'
import { RENTED_COURTS_TEXT_MAX_LENGTH } from '@/lib/rented-courts'
import styles from './CreateSessionForm.module.css'

interface Venue {
  id: string
  name: string
}

interface VenueCourtRow {
  id: string
  court_no: number
  name: string | null
}

export default function CreateSessionForm() {
  const router = useRouter()
  const supabase = createClient()
  const { user } = useUser()

  const PER_COURT_DEFAULT = 8
  const DEFAULT_COURTS = 2

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [courtCount, setCourtCount] = useState(DEFAULT_COURTS)
  const [assignmentMode, setAssignmentMode] = useState('rotation_fair')
  const [allowSelfSignup, setAllowSelfSignup] = useState(false)
  const [maxParticipants, setMaxParticipants] = useState(() => Math.max(1, DEFAULT_COURTS * PER_COURT_DEFAULT))
  const [feeTwd, setFeeTwd] = useState(0)
  const [shuttlecockType, setShuttlecockType] = useState<ShuttlecockTypeId>(DEFAULT_SHUTTLECOCK_TYPE)
  const [shuttleBrand, setShuttleBrand] = useState('')

  // Venue
  const [venues, setVenues] = useState<Venue[]>([])
  const [selectedVenueId, setSelectedVenueId] = useState<string>('')
  const [showNewVenue, setShowNewVenue] = useState(false)
  const [newVenueName, setNewVenueName] = useState('')

  const [venueCourts, setVenueCourts] = useState<VenueCourtRow[]>([])
  const [rentedCourtNos, setRentedCourtNos] = useState<number[]>([])
  const [rentedCourtsFreeText, setRentedCourtsFreeText] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toIsoSafe = (dtLocal: string) => {
    const d = new Date(dtLocal)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  const isEndAfterStart = (s: string, e: string) => {
    const sd = new Date(s)
    const ed = new Date(e)
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return false
    return ed.getTime() > sd.getTime()
  }

  const addHoursLocal = (dtLocal: string, hours: number) => {
    const d = new Date(dtLocal)
    if (isNaN(d.getTime())) return ''
    d.setHours(d.getHours() + hours)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

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

  useEffect(() => {
    if (!selectedVenueId) {
      setVenueCourts([])
      setRentedCourtNos([])
      return
    }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('courts')
        .select('id, court_no, name')
        .eq('venue_id', selectedVenueId)
        .eq('is_active', true)
        .order('court_no')
      if (!cancelled) {
        setVenueCourts((data as VenueCourtRow[]) || [])
        setRentedCourtNos([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVenueId, supabase])

  // 依場地數自動調整「人數上限」為 8 的倍數（仍可手動改）
  useEffect(() => {
    const cc = Math.max(1, Number(courtCount || 1))
    setMaxParticipants(cc * PER_COURT_DEFAULT)
  }, [courtCount])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      if (!startAt || !endAt) {
        throw new Error('請填寫開始時間與結束時間')
      }
      if (!isEndAfterStart(startAt, endAt)) {
        throw new Error('結束時間必須晚於開始時間（例如開始 20:00，結束不可選同日 11:00）')
      }

      const startIso = toIsoSafe(startAt)
      const endIso = toIsoSafe(endAt)
      if (!startIso || !endIso) {
        throw new Error('時間格式不正確，請重新選擇開始/結束時間')
      }

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

      const brandTrim = shuttleBrand.trim().slice(0, SHUTTLECOCK_BRAND_MAX_LENGTH)

      const rentedMeta: Record<string, unknown> = {}
      const freeTrim = rentedCourtsFreeText.trim().slice(0, RENTED_COURTS_TEXT_MAX_LENGTH)
      if (venueCourts.length > 0 && rentedCourtNos.length > 0) {
        const sorted = [...rentedCourtNos].sort((a, b) => a - b)
        const labels = sorted.map((no) => {
          const c = venueCourts.find((x) => x.court_no === no)
          const nm = c?.name?.trim()
          return nm || `${no} 號`
        })
        rentedMeta.rented_court_nos = sorted
        rentedMeta.rented_court_labels = labels
        if (freeTrim) rentedMeta.rented_courts_note = freeTrim
      } else if (freeTrim) {
        rentedMeta.rented_courts_text = freeTrim
      }

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
            start_at: startIso,
            end_at: endIso,
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
              shuttlecock_type: shuttlecockType,
              ...(brandTrim ? { shuttlecock_brand: brandTrim } : {}),
              ...rentedMeta,
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
    if (!val) return
    // 若尚未填結束時間，或結束時間不晚於開始時間，則自動延後 2 小時
    if (!endAt || !isEndAfterStart(val, endAt)) {
      setEndAt(addHoursLocal(val, 2))
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
            min={startAt || undefined}
            required
          />
        </div>
      </div>

      {/* 用球種類 */}
      <div className={styles.field}>
        <span className={styles.shuttleLegend}>用球種類 *</span>
        <p className={styles.shuttleHint}>報名分享頁會顯示圖示與說明，方便球友準備。</p>
        <div className={styles.shuttleGrid}>
          {SHUTTLECOCK_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={`${styles.shuttleCard} ${shuttlecockType === opt.id ? styles.shuttleCardActive : ''}`}
            >
              <input
                type="radio"
                name="shuttlecockType"
                value={opt.id}
                checked={shuttlecockType === opt.id}
                onChange={() => setShuttlecockType(opt.id)}
                className={styles.shuttleRadio}
              />
              <span className={styles.shuttleVisual}>
                <img src={opt.imagePath} alt="" width={48} height={48} className={styles.shuttleImg} />
              </span>
              <span className={styles.shuttleTitle}>{opt.labelZh}</span>
              <span className={styles.shuttleSub}>{opt.hintZh}</span>
            </label>
          ))}
        </div>
        <div className={styles.field}>
          <label htmlFor="shuttleBrand">品牌／型號（選填）</label>
          <input
            id="shuttleBrand"
            type="text"
            className="input"
            placeholder="例如：YONEX AS-50、RSL Supreme、勝利 Master No.3…"
            value={shuttleBrand}
            maxLength={SHUTTLECOCK_BRAND_MAX_LENGTH}
            onChange={(e) => setShuttleBrand(e.target.value)}
            autoComplete="off"
          />
          <span className={styles.shuttleBrandCounter}>
            {shuttleBrand.length}/{SHUTTLECOCK_BRAND_MAX_LENGTH}
          </span>
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

      {/* 租借場地（選填） */}
      <div className={styles.field}>
        <span className={styles.rentedLegend}>租借場地（選填）</span>
        <p className={styles.rentedHint}>
          若已確定使用哪些場地，可勾選或填寫；將顯示於公開報名頁。本場次「場地數量」為 {courtCount}{' '}
          面，建議與實際租借面數一致。
        </p>
        {venueCourts.length > 0 ? (
          <div className={styles.rentedChecks}>
            {venueCourts.map((c) => {
              const label = c.name?.trim() || `${c.court_no} 號場`
              const checked = rentedCourtNos.includes(c.court_no)
              return (
                <label key={c.id} className={`${styles.rentedCheck} ${checked ? styles.rentedCheckOn : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setRentedCourtNos((prev) =>
                        prev.includes(c.court_no)
                          ? prev.filter((n) => n !== c.court_no)
                          : [...prev, c.court_no].sort((a, b) => a - b)
                      )
                    }}
                  />
                  <span className={styles.rentedCheckLabel}>{label}</span>
                  <span className={styles.rentedNo}>#{c.court_no}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className={styles.rentedEmpty}>
            {selectedVenueId
              ? '此場館尚未登錄球場面位，請至「場館管理」新增球場，或使用下方文字欄位填寫。'
              : '選擇場館後，若該館已登錄球場可勾選；未指定場館時請以文字填寫。'}
          </p>
        )}
        <div className={styles.field}>
          <label htmlFor="rentedCourtsFreeText">
            {venueCourts.length > 0 ? '手動補充／其他說明（選填）' : '場地編號或說明（選填）'}
          </label>
          <input
            id="rentedCourtsFreeText"
            type="text"
            className="input"
            placeholder="例：A 館 3、5、7 號，或現場分配"
            value={rentedCourtsFreeText}
            maxLength={RENTED_COURTS_TEXT_MAX_LENGTH}
            onChange={(e) => setRentedCourtsFreeText(e.target.value)}
            autoComplete="off"
          />
          <span className={styles.rentedCounter}>
            {rentedCourtsFreeText.length}/{RENTED_COURTS_TEXT_MAX_LENGTH}
          </span>
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
