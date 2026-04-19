'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import {
  DEFAULT_SHUTTLECOCK_TYPE,
  SHUTTLECOCK_BRAND_MAX_LENGTH,
  SHUTTLECOCK_OPTIONS,
  parseShuttlecockTypeFromMetadata,
  parseShuttlecockBrandFromMetadata,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sessionMaxParticipants(s: any): number {
  const m = s?.metadata
  if (m && typeof m === 'object' && m.max_participants != null) {
    const n = Number(m.max_participants)
    if (Number.isFinite(n)) return n
  }
  if (s?.max_participants != null) return Number(s.max_participants)
  return 24
}

function sessionFeeTwd(s: { fee_twd?: unknown; metadata?: unknown }): number {
  const m = s?.metadata
  if (m && typeof m === 'object' && (m as { fee_twd?: unknown }).fee_twd != null) {
    const n = Number((m as { fee_twd?: unknown }).fee_twd)
    if (Number.isFinite(n)) return n
  }
  return s?.fee_twd != null ? Number(s.fee_twd) : 0
}

function toDatetimeLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface EditSessionFormProps {
  sessionId: string
  initialSession: Record<string, unknown>
}

export default function EditSessionForm({ sessionId, initialSession }: EditSessionFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const { user } = useUser()

  const [title, setTitle] = useState(String(initialSession.title || ''))
  const [description, setDescription] = useState(String(initialSession.description || ''))
  const [startAt, setStartAt] = useState(() =>
    toDatetimeLocalInput(new Date(String(initialSession.start_at)))
  )
  const [endAt, setEndAt] = useState(() =>
    toDatetimeLocalInput(new Date(String(initialSession.end_at)))
  )
  const [courtCount, setCourtCount] = useState(Number(initialSession.court_count) || 1)
  const [assignmentMode, setAssignmentMode] = useState(String(initialSession.assignment_mode || 'rotation_fair'))
  const [allowSelfSignup, setAllowSelfSignup] = useState(Boolean(initialSession.allow_self_signup))
  const [maxParticipants, setMaxParticipants] = useState(sessionMaxParticipants(initialSession))
  const [feeTwd, setFeeTwd] = useState(sessionFeeTwd(initialSession))
  const [shuttlecockType, setShuttlecockType] = useState<ShuttlecockTypeId>(
    parseShuttlecockTypeFromMetadata(initialSession.metadata) || DEFAULT_SHUTTLECOCK_TYPE
  )
  const [shuttleBrand, setShuttleBrand] = useState(
    () => parseShuttlecockBrandFromMetadata(initialSession.metadata) || ''
  )

  const [venues, setVenues] = useState<Venue[]>([])
  const [selectedVenueId, setSelectedVenueId] = useState<string>(String(initialSession.venue_id || ''))
  const [venueCourts, setVenueCourts] = useState<VenueCourtRow[]>([])
  const [rentedCourtNos, setRentedCourtNos] = useState<number[]>(() => {
    const m = initialSession.metadata as Record<string, unknown> | undefined
    const nos = m?.rented_court_nos
    if (!Array.isArray(nos)) return []
    return nos.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
  })
  const [rentedCourtsFreeText, setRentedCourtsFreeText] = useState(() => {
    const m = initialSession.metadata as Record<string, unknown> | undefined
    const note = typeof m?.rented_courts_note === 'string' ? m.rented_courts_note : ''
    const text = typeof m?.rented_courts_text === 'string' ? m.rented_courts_text : ''
    return (note || text || '').toString().slice(0, RENTED_COURTS_TEXT_MAX_LENGTH)
  })

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

  useEffect(() => {
    if (!user) return
    void (async () => {
      const { data: owned } = await supabase
        .from('venues')
        .select('id, name')
        .eq('owner_user_id', user.id)
        .eq('is_active', true)

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
      const unique = allVenues.filter((v, i, arr) => arr.findIndex((a) => a.id === v.id) === i)
      setVenues(unique)
    })()
  }, [user, supabase])

  useEffect(() => {
    if (!selectedVenueId) {
      setVenueCourts([])
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
      if (!cancelled) setVenueCourts((data as VenueCourtRow[]) || [])
    })()
    return () => {
      cancelled = true
    }
  }, [selectedVenueId, supabase])

  const handleStartChange = useCallback((val: string) => {
    setStartAt(val)
    if (!val) return
    if (!endAt || !isEndAfterStart(val, endAt)) {
      setEndAt(addHoursLocal(val, 2))
    }
  }, [endAt])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      if (!startAt || !endAt) throw new Error('請填寫開始時間與結束時間')
      if (!isEndAfterStart(startAt, endAt)) {
        throw new Error('結束時間必須晚於開始時間')
      }
      const startIso = toIsoSafe(startAt)
      const endIso = toIsoSafe(endAt)
      if (!startIso || !endIso) throw new Error('時間格式不正確')

      const venueId = selectedVenueId || null
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

      const prevMeta =
        initialSession.metadata && typeof initialSession.metadata === 'object'
          ? (initialSession.metadata as Record<string, unknown>)
          : {}

      const metadata = {
        ...prevMeta,
        max_participants: maxParticipants,
        fee_twd: feeTwd,
        shuttlecock_type: shuttlecockType,
        ...(brandTrim ? { shuttlecock_brand: brandTrim } : {}),
        ...rentedMeta,
      }

      const { error: upErr } = await supabase
        .from('sessions')
        .update({
          title: title.trim(),
          description: description.trim() || null,
          venue_id: venueId,
          start_at: startIso,
          end_at: endIso,
          court_count: courtCount,
          assignment_mode: assignmentMode,
          allow_self_signup: allowSelfSignup,
          max_participants: maxParticipants,
          fee_twd: feeTwd,
          metadata,
        })
        .eq('id', sessionId)
        .eq('host_user_id', user.id)

      if (upErr) {
        const msg = upErr.message || ''
        if (msg.includes('SESSION_TERMINAL_LOCKED')) {
          throw new Error('此場次已結束或已取消，無法再修改。')
        }
        throw upErr
      }

      router.push(`/sessions/${sessionId}`)
    } catch (err: unknown) {
      console.error(err)
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '更新失敗，請稍後再試'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.field}>
        <label htmlFor="title">場次標題 *</label>
        <input
          id="title"
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="description">說明</label>
        <textarea
          id="description"
          className={`input ${styles.textarea}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <div className={styles.field}>
        <label>場館</label>
        <select
          className={`input ${styles.select}`}
          value={selectedVenueId}
          onChange={(e) => setSelectedVenueId(e.target.value)}
        >
          <option value="">不指定場館</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

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

      <div className={styles.field}>
        <span className={styles.shuttleLegend}>用球種類 *</span>
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
            value={shuttleBrand}
            maxLength={SHUTTLECOCK_BRAND_MAX_LENGTH}
            onChange={(e) => setShuttleBrand(e.target.value)}
          />
        </div>
      </div>

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

      <div className={styles.field}>
        <span className={styles.rentedLegend}>租借場地（選填）</span>
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
              : '選擇場館後可勾選面位；未指定場館時請以文字填寫。'}
          </p>
        )}
        <div className={styles.field}>
          <label htmlFor="rentedCourtsFreeText">補充說明（選填）</label>
          <input
            id="rentedCourtsFreeText"
            type="text"
            className="input"
            value={rentedCourtsFreeText}
            maxLength={RENTED_COURTS_TEXT_MAX_LENGTH}
            onChange={(e) => setRentedCourtsFreeText(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.toggleInfo}>
          <label>允許球員自行報名</label>
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

      <div className={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
          取消
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
          {loading ? '儲存中...' : '儲存變更'}
        </button>
      </div>
    </form>
  )
}
