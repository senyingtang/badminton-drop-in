'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from './share.module.css'
import { useUser } from '@/hooks/useUser'
import { getRentedCourtsDisplay } from '@/lib/rented-courts'
import { getShuttlecockBrandFromSession, getShuttlecockOptionFromSession } from '@/lib/shuttlecock'
import { themeCustomVars, themePresetVars, type ThemeCustom, type ThemePresetId } from '@/lib/theme-presets'
import { buildVenueGoogleMapsUrl } from '@/lib/googleMapsLink'
import Link from 'next/link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

type PublicRosterRow = {
  session_participant_id?: string
  roster_kind: string
  display_name: string
  waitlist_order: number | null
  is_self: boolean
  guest_level?: number | null
  is_managed_by_registrar?: boolean
}

function newGuestFormRow(): { key: string; nickname: string; level: number } {
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `g-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return { key, nickname: '', level: 6 }
}

function sessionMaxParticipants(s: Row): number | undefined {
  const m = s?.metadata
  if (m && typeof m === 'object' && m.max_participants != null) {
    const n = Number(m.max_participants)
    return Number.isFinite(n) ? n : undefined
  }
  if (s?.max_participants != null) return Number(s.max_participants)
  return undefined
}

function sessionFeeTwd(s: Row): number {
  const m = s?.metadata
  if (m && typeof m === 'object' && m.fee_twd != null) {
    const n = Number(m.fee_twd)
    return Number.isFinite(n) ? n : 0
  }
  return s?.fee_twd != null ? Number(s.fee_twd) : 0
}

function shareCodeFromParams(code: string | string[] | undefined): string {
  if (code == null) return ''
  const raw = Array.isArray(code) ? code[0] : code
  return typeof raw === 'string' ? decodeURIComponent(raw).trim() : ''
}

export default function PublicSessionPage() {
  const params = useParams()
  const code = shareCodeFromParams(params.code as string | string[] | undefined)
  const supabase = createClient()
  const { user, loading: userLoading } = useUser()

  const [session, setSession] = useState<Row | null>(null)
  const [rosterRows, setRosterRows] = useState<PublicRosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [venue, setVenue] = useState<Row | null>(null)
  const [playerInfo, setPlayerInfo] = useState<Row | null>(null)
  const [selfLevel, setSelfLevel] = useState(6)
  const [oneTimeName, setOneTimeName] = useState('')

  const [prefs, setPrefs] = useState<{
    rented_courts_display_mode: 'below' | 'inline'
    theme_preset: ThemePresetId
    theme_custom: ThemeCustom | null
  } | null>(null)

  const [oaAddFriendUrl, setOaAddFriendUrl] = useState<string | null>(null)
  const [showLinePopup, setShowLinePopup] = useState(false)
  const [creatingPlayer, setCreatingPlayer] = useState(false)

  const [signupMode, setSignupMode] = useState<'self' | 'friends'>('self')
  const [guestRows, setGuestRows] = useState<{ key: string; nickname: string; level: number }[]>(() => [
    newGuestFormRow(),
  ])

  const venueGoogleHref = useMemo(() => {
    if (!venue) return null
    return buildVenueGoogleMapsUrl({
      venueName: venue.name,
      googleMapsUrl: venue.google_maps_url,
      fullAddress: venue.full_address,
      addressText: venue.address_text,
      city: venue.city,
      district: venue.district,
    })
  }, [venue])

  // 分享連結：未登入就先導向登入頁，登入後再回來
  useEffect(() => {
    if (!code) return
    if (userLoading) return
    if (user) return
    const returnTo = `/s/${encodeURIComponent(code)}`
    window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`
  }, [code, user, userLoading])

  // LINE 登入回跳提示（避免「看起來沒登入成功」其實是 callback 失敗）
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const line = sp.get('line')
      const reason = sp.get('reason')
      if (line === 'ok') {
        // 只提示一次就好
        window.history.replaceState({}, '', window.location.pathname)
      }
      if (line === 'err') {
        alert(`LINE 登入失敗：${reason || 'unknown'}`)
        window.history.replaceState({}, '', window.location.pathname)
      }
    } catch {
      // ignore
    }
  }, [])

  const startLineLogin = async () => {
    try {
      window.location.href = `/api/auth/line/start?returnTo=${encodeURIComponent(`/s/${code}`)}`
    } catch (e) {
      alert(e instanceof Error ? e.message : 'LINE 登入失敗')
    }
  }

  const loadSession = useCallback(async () => {
    if (!code) {
      setSession(null)
      setLoading(false)
      return
    }

    // ilike：分享碼為 text，避免網址大小寫與 DB 不一致；分享碼字元集不含 % / _
    const { data: sessionData, error: sessionErr } = await supabase
      .from('sessions')
      .select('*')
      .ilike('share_signup_code', code)
      .maybeSingle()

    if (sessionErr || !sessionData) {
      if (sessionErr) console.warn('public session load:', sessionErr.message)
      setSession(null)
      setLoading(false)
      return
    }

    setSession(sessionData)

    if (sessionData.venue_id) {
      // 公開頁：venue 含地圖欄位（full_address / google_maps_url）
      const { data: v } = await supabase
        .from('venues')
        .select('id, name, address_text, city, district, full_address, google_maps_url')
        .eq('id', sessionData.venue_id)
        .maybeSingle()
      setVenue(v)
    } else {
      setVenue(null)
    }

    if (user) {
      const { data: pData } = await supabase.from('players').select('*').eq('auth_user_id', user.id).maybeSingle()
      setPlayerInfo(pData)
      // 一次性匿名暱稱預設帶入球員顯示名（可自行改成當次使用名稱）
      const baseName = typeof pData?.display_name === 'string' ? pData.display_name.trim() : ''
      setOneTimeName((prev) => (prev ? prev : baseName))
    } else {
      setPlayerInfo(null)
      setOneTimeName('')
    }

    // 名單：改走本站 API 代理，避免瀏覽器端被 Supabase Data API 的 CORS/500 影響造成長時間 Loading
    try {
      const res = await fetch(`/api/public/session-roster?code=${encodeURIComponent(code)}`)
      const j = (await res.json().catch(() => null)) as { ok?: boolean; rows?: PublicRosterRow[]; error?: string } | null
      if (!res.ok || !j?.ok) {
        console.warn('public roster:', j?.error || `HTTP ${res.status}`)
        setRosterRows([])
      } else {
        const rawRows = (j.rows as unknown[]) || []
        setRosterRows(
          rawRows.map((raw) => {
            const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
            return {
              session_participant_id:
                typeof o.session_participant_id === 'string' ? o.session_participant_id : undefined,
              roster_kind: String(o.roster_kind ?? ''),
              display_name: String(o.display_name ?? ''),
              waitlist_order:
                o.waitlist_order == null || o.waitlist_order === '' ? null : Number(o.waitlist_order),
              is_self: Boolean(o.is_self),
              guest_level: o.guest_level == null || o.guest_level === '' ? null : Number(o.guest_level),
              is_managed_by_registrar: Boolean(o.is_managed_by_registrar),
            }
          })
        )
      }
    } catch (e) {
      console.warn('public roster:', e instanceof Error ? e.message : 'failed to fetch')
      setRosterRows([])
    }

    setLoading(false)
  }, [code, supabase, user])

  useEffect(() => {
    setLoading(true)
    void loadSession()
  }, [loadSession])

  useEffect(() => {
    if (!session?.id) return
    const sid = session.id as string
    const ch = supabase
      .channel(`public-roster-${sid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `session_id=eq.${sid}`,
        },
        () => {
          void loadSession()
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [session?.id, supabase, loadSession])

  useEffect(() => {
    if (!code) return
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_pickup_group_prefs_by_share_code', {
        p_share_code: code,
      })
      if (error) {
        setPrefs(null)
        return
      }
      const row = (Array.isArray(data) ? data[0] : data) as {
        rented_courts_display_mode?: 'below' | 'inline'
        theme_preset?: ThemePresetId
        theme_custom?: ThemeCustom
      } | null
      setPrefs({
        rented_courts_display_mode: row?.rented_courts_display_mode === 'inline' ? 'inline' : 'below',
        theme_preset: (row?.theme_preset as ThemePresetId) || 'indigo',
        theme_custom: row?.theme_custom ?? null,
      })
    })()
  }, [code, supabase])

  // LINE@ Pop-up（公開報名頁導流加入好友）
  useEffect(() => {
    if (!code) return
    try {
      const joined = window.localStorage.getItem('kb_line_oa_joined') === '1'
      if (joined) return
    } catch {
      // ignore
    }

    void (async () => {
      const { data, error } = await supabase.rpc('get_public_platform_line_oa')
      if (error) {
        setOaAddFriendUrl(null)
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (Array.isArray(data) ? data[0] : data) as any
      const url = typeof row?.oa_add_friend_url === 'string' ? row.oa_add_friend_url.trim() : ''
      setOaAddFriendUrl(url || null)
      if (url) setShowLinePopup(true)
    })()
  }, [code, supabase])

  const rpcErrorMessage = (err: unknown): string => {
    const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : ''
    if (msg.includes('signup_link_invalid')) return '報名連結不存在或已失效'
    if (msg.includes('session_signup_not_open')) return '此場次尚未開放報名或已停止報名'
    // legacy（舊版 RPC 會混用 not found / not open）
    if (msg.includes('session_not_found_or_closed')) return '此場次尚未開放報名或已停止報名'
    if (msg.includes('invalid_display_name')) return '請填寫有效的顯示名稱（1–100 字）'
    if (msg.includes('too_many_guests')) return '一次最多協助 15 位朋友報名'
    if (msg.includes('invalid_guests')) return '請至少新增一位朋友並填寫暱稱'
    if (msg.includes('invalid_guest_display_name')) return '請填寫每位朋友的有效暱稱（1–100 字）'
    if (msg.includes('invalid_guest_level')) return '請為每位朋友選擇有效級數（1–18）'
    if (msg.includes('duplicate_name')) return '此場次已有人使用相同顯示名稱報名，請更換名稱'
    if (msg.includes('duplicate_player_code')) return '此球員代碼已被使用，請換一個'
    if (msg.includes('invalid_player_code')) return '球員代碼須為 3–30 個英數字（可留空由系統產生）'
    if (msg.includes('already_signed_up')) return '您已經在報名名單中了！'
    if (msg.includes('not_allowed_to_resignup')) return '目前狀態無法再次報名，請聯絡主辦協助處理。'
    return '報名失敗，請稍後再試'
  }

  const handleSignup = async () => {
    if (!session || !code) return

    if (!user) return

    if (!playerInfo) {
      alert('尚未建立球員資料，請先點「建立球員資料」後再報名。')
      return
    }

    // 一次性匿名暱稱（僅該場次有效）
    const trimmedOneTime = oneTimeName.trim()
    if (!trimmedOneTime) {
      alert('請填寫本次場次使用的名稱（一次性匿名暱稱）')
      return
    }
    if (trimmedOneTime.length > 100) {
      alert('名稱過長，請縮短至 100 字以內')
      return
    }

    // 未綁 LINE：報名前免責告知（仍可報名）
    // 目前欄位仍使用 line_user_id；未來若改為 line_uid，這裡再一起調整。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineUid = (playerInfo as any)?.line_uid || (playerInfo as any)?.line_user_id
    if (!lineUid) {
      const ok = window.confirm(
        '您目前尚未綁定 LINE。\n\n若名單有異動（例如候補轉正選、場次取消/變更），系統將無法第一時間通知，可能導致您錯失權益。\n\n仍要繼續報名嗎？'
      )
      if (!ok) return
    }

    setActionLoading(true)

    try {
      if (rosterRows.some((r) => r.is_self)) {
        alert('您已經在報名名單中了！')
        return
      }

      const { data: inserted, error } = await supabase.rpc('self_signup_to_session_by_share_code', {
        p_share_code: code,
        p_self_level: selfLevel,
        p_signup_note: null,
        p_session_display_name: trimmedOneTime,
      })
      if (error) throw error

      // 若已綁定 LINE@，推播「報名成功」通知（未綁定則 API 會自動 skipped）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spid = (inserted as any)?.id as string | undefined
      if (spid) {
        void fetch('/api/line/notify-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionParticipantId: spid }),
        }).catch(() => {})
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isWaitlist = (inserted as any)?.status === 'waitlist'
      alert(isWaitlist ? '已成功列入候補名單！' : '報名成功！已進入正選名單。')

      window.location.reload()
    } catch (err) {
      console.error(err)
      alert(rpcErrorMessage(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleGuestSignup = async () => {
    if (!session || !code || !user || !playerInfo) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineUid = (playerInfo as any)?.line_uid || (playerInfo as any)?.line_user_id
    if (!lineUid) {
      const ok = window.confirm(
        '您目前尚未綁定 LINE。\n\n代朋友報名時，名單異動通知將發送給您；若未綁定 LINE，將無法推播。\n\n仍要繼續嗎？'
      )
      if (!ok) return
    }

    const payload = guestRows
      .map((g) => ({
        display_name: g.nickname.trim(),
        level: g.level,
      }))
      .filter((g) => g.display_name.length > 0)

    if (payload.length === 0) {
      alert('請至少填寫一位朋友的暱稱')
      return
    }

    setActionLoading(true)
    try {
      const { data: inserted, error } = await supabase.rpc('self_register_guest_friends_by_share_code', {
        p_share_code: code,
        p_guests: payload,
      })
      if (error) throw error

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawResults = (inserted as any)?.results
      const arr = Array.isArray(rawResults) ? rawResults : []
      for (const item of arr) {
        const spid =
          item && typeof item === 'object' && 'id' in item ? String((item as { id: unknown }).id) : ''
        if (!spid) continue
        void fetch('/api/line/notify-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionParticipantId: spid }),
        }).catch(() => {})
      }

      alert(`已成功送出 ${payload.length} 位朋友的報名，將重新載入名單。`)
      window.location.reload()
    } catch (err) {
      console.error(err)
      alert(rpcErrorMessage(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelManagedGuest = async (participantId: string) => {
    if (!participantId) return
    if (!window.confirm('確定要取消這位朋友的報名？')) return
    setActionLoading(true)
    try {
      const { error } = await supabase.rpc('self_cancel_guest_registration_by_registrar', {
        p_session_participant_id: participantId,
      })
      if (error) throw error
      await loadSession()
    } catch (e) {
      console.error(e)
      alert('取消失敗，請稍後再試')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入場次資訊...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className={styles.container}>
        <div className={styles.errorCard}>
          <span className={styles.errorIcon}>❌</span>
          <h2>找不到此場次</h2>
          <p>請確認您的報名連結是否正確，或場次已被主辦方關閉。</p>
        </div>
      </div>
    )
  }

  const cap = sessionMaxParticipants(session)
  const fee = sessionFeeTwd(session)
  const shuttleOpt = getShuttlecockOptionFromSession(session)
  const shuttleBrand = getShuttlecockBrandFromSession(session)
  const rentedCourtsDisplay = getRentedCourtsDisplay(session.metadata)

  const displayMode = prefs?.rented_courts_display_mode ?? 'below'

  const themeStyle: React.CSSProperties = (() => {
    const preset = prefs?.theme_preset ?? 'indigo'
    const presetVars = preset !== 'custom' ? themePresetVars(preset as Exclude<ThemePresetId, 'custom'>) : {}
    const customVars = preset === 'custom' ? themeCustomVars(prefs?.theme_custom) : {}
    return { ...presetVars, ...customVars } as React.CSSProperties
  })()
  const mainCount = rosterRows.filter((r) => r.roster_kind === 'main').length
  const waitlistCount = rosterRows.filter((r) => r.roster_kind === 'waitlist').length

  const selfRow = rosterRows.find((r) => r.is_self)
  const managedRows = rosterRows.filter((r) => r.is_managed_by_registrar)
  const myRecord =
    playerInfo && selfRow
      ? {
          status: selfRow.roster_kind === 'waitlist' ? 'waitlist' : 'confirmed_main',
          waitlist_order: selfRow.waitlist_order,
        }
      : null

  const signupOpenStatuses = [
    'registration_open',
    'pending_confirmation',
    'ready_for_assignment',
    'assigned',
    'in_progress',
    'round_finished',
    // 兼容其他環境可能使用的狀態命名（不假設 DB 一定存在）
    'open',
    'published',
    'signup_open',
    'open_for_registration',
  ]
  const isSignupOpen = signupOpenStatuses.includes(session.status)

  return (
    <div className={styles.container} style={themeStyle}>
      {showLinePopup && oaAddFriendUrl && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="加入 LINE@ 提示"
          onClick={() => setShowLinePopup(false)}
        >
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>加入 LINE@，即時收到名單異動通知</h2>
            <p className={styles.modalDesc}>
              加入官方帳號後，當您<strong>從候補遞補為正選</strong>、或報名狀態被主辦調整時，可透過 LINE 收到提醒（僅通知您本人，不會群發）。
            </p>
            <div className={styles.modalActions}>
              <a className="btn btn-primary" href={oaAddFriendUrl} target="_blank" rel="noreferrer">
                加入 LINE@
              </a>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  try {
                    window.localStorage.setItem('kb_line_oa_joined', '1')
                  } catch {
                    // ignore
                  }
                  setShowLinePopup(false)
                }}
              >
                我已加入
              </button>
            </div>
            <button type="button" className={styles.modalClose} onClick={() => setShowLinePopup(false)}>
              先關閉（下次進入報名頁仍會提示）
            </button>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <span className={styles.badge}>
          {isSignupOpen ? '報名進行中' : '準備／進行中'}
        </span>
        <h1 className={styles.title}>{session.title}</h1>
        {session.description && <p className={styles.desc}>{session.description}</p>}
      </div>

      <div className={styles.cardsGrid}>
        <div className={styles.mainCard}>
          <div className={styles.infoRow}>
            <span className={styles.icon}>📅</span>
            <div>
              <div className={styles.label}>時間</div>
              <div className={styles.value}>
                {new Date(session.start_at).toLocaleString('zh-TW', {
                  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })} - 
                {new Date(session.end_at).toLocaleTimeString('zh-TW', {
                  hour: '2-digit', minute: '2-digit'
                })}
              </div>
            </div>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.shuttleIconWrap}>
              <img
                src={shuttleOpt.imagePath}
                alt=""
                width={40}
                height={40}
                className={styles.shuttleIconImg}
              />
            </span>
            <div>
              <div className={styles.label}>用球</div>
              <div className={styles.value}>
                {shuttleOpt.labelZh}
                {shuttleBrand ? (
                  <>
                    {' '}
                    <span className={styles.shuttleBrandEm}>· {shuttleBrand}</span>
                  </>
                ) : null}
              </div>
              {!shuttleBrand ? (
                <div className={styles.shuttleTagline}>{shuttleOpt.hintZh}</div>
              ) : null}
            </div>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.icon}>🏸</span>
            <div>
              <div className={styles.label}>場地數量</div>
              <div className={styles.value}>
                {session.court_count} 面
                {displayMode === 'inline' && rentedCourtsDisplay ? (
                  <span className={styles.inlineParen}>（{rentedCourtsDisplay}）</span>
                ) : null}
              </div>
            </div>
          </div>
          {displayMode === 'below' && rentedCourtsDisplay && (
            <div className={styles.infoRow}>
              <span className={styles.icon}>🥅</span>
              <div>
                <div className={styles.label}>租借場地</div>
                <div className={styles.value}>{rentedCourtsDisplay}</div>
              </div>
            </div>
          )}
          <div className={styles.infoRow}>
            <span className={styles.icon}>👥</span>
            <div>
              <div className={styles.label}>報名人數</div>
              <div className={styles.value}>
                {mainCount} / {cap != null ? cap : '不限'} 人 (候補 {waitlistCount} 人)
              </div>
            </div>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.icon}>💰</span>
            <div>
              <div className={styles.label}>費用</div>
              <div className={styles.value}>
                {fee > 0 ? `NT$ ${fee}` : '請洽主辦'}
                {session.fee_description && <span className={styles.subtext}> {session.fee_description}</span>}
              </div>
            </div>
          </div>
        </div>

        {venue && (
          <div className={styles.venueCard}>
            <h3 className={styles.cardTitle}>場館資訊</h3>
            <div className={styles.venueName}>{venue.name}</div>
            {(() => {
              const city = typeof venue.city === 'string' ? venue.city.trim() : ''
              const dist = typeof venue.district === 'string' ? venue.district.trim() : ''
              const line = [city, dist].filter(Boolean).join(' ')
              if (!line) return null
              return (
                <div className={styles.venueItem}>
                  <span className={styles.vIcon}>📍</span>
                  <span className={styles.vText}>{line}</span>
                </div>
              )
            })()}
            {(() => {
              const full = typeof venue.full_address === 'string' ? venue.full_address.trim() : ''
              const addr = typeof venue.address_text === 'string' ? venue.address_text.trim() : ''
              const display = full || addr
              if (!display) return null
              return (
                <div className={styles.venueItem}>
                  <span className={styles.vIcon}>📍</span>
                  <span className={styles.vText}>{display}</span>
                </div>
              )
            })()}
            {venueGoogleHref ? (
              <a href={venueGoogleHref} target="_blank" rel="noopener noreferrer" className={styles.mapLink}>
                Google 導航
              </a>
            ) : null}
          </div>
        )}
      </div>

      <div className={styles.actionSection}>
        {!isSignupOpen && (
          <div className={styles.noticeBox}>
            <span className={styles.noticeIcon}>ℹ️</span>
            <div>
              <div className={styles.noticeTitle}>此場次尚未開放報名</div>
              <div className={styles.noticeDesc}>請等待主辦方點擊「開始報名」後再回來填寫。</div>
            </div>
          </div>
        )}
        {isSignupOpen && user && playerInfo && (
          <div style={{ marginBottom: 16 }}>
            <div className={styles.formRow}>
              <span className={styles.label}>報名方式</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: myRecord ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="radio"
                    name="signupMode"
                    checked={signupMode === 'self'}
                    onChange={() => setSignupMode('self')}
                    disabled={Boolean(myRecord)}
                  />
                  我要報名自己
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="signupMode"
                    checked={signupMode === 'friends'}
                    onChange={() => setSignupMode('friends')}
                  />
                  我要幫朋友報名
                </label>
              </div>
            </div>

            {signupMode === 'self' && !myRecord && (
              <>
                <div className={styles.formRow}>
                  <label htmlFor="oneTimeName">本次使用名稱（一次性匿名）</label>
                  <input
                    id="oneTimeName"
                    type="text"
                    value={oneTimeName}
                    onChange={(e) => setOneTimeName(e.target.value)}
                    placeholder="例如：小明 / 阿哲 / 來打球"
                    maxLength={100}
                  />
                  <p className={styles.formHint}>僅用於此場次顯示；場次結束或取消後會清除。</p>
                </div>
                <div className={styles.levelRow}>
                  <label htmlFor="selfLevel">自評程度（1–18）</label>
                  <input
                    id="selfLevel"
                    type="range"
                    min={1}
                    max={18}
                    value={selfLevel}
                    onChange={(e) => setSelfLevel(Number(e.target.value))}
                  />
                  <span className={styles.levelValue}>{selfLevel}</span>
                </div>
                <button
                  type="button"
                  className={`btn btn-primary ${styles.signupBtn}`}
                  onClick={() => void handleSignup()}
                  disabled={actionLoading || !isSignupOpen}
                >
                  {actionLoading ? '處理中...' : '送出自己報名'}
                </button>
              </>
            )}

            {signupMode === 'friends' && (
              <div style={{ marginTop: 12 }}>
                {guestRows.map((g, idx) => (
                  <div
                    key={g.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 120px auto',
                      gap: 10,
                      alignItems: 'end',
                      marginBottom: 12,
                    }}
                  >
                    <div className={styles.formRow} style={{ marginBottom: 0 }}>
                      <label htmlFor={`gf-name-${g.key}`}>朋友 {idx + 1} 暱稱</label>
                      <input
                        id={`gf-name-${g.key}`}
                        type="text"
                        value={g.nickname}
                        onChange={(e) => {
                          const v = e.target.value
                          setGuestRows((prev) => prev.map((x) => (x.key === g.key ? { ...x, nickname: v } : x)))
                        }}
                        placeholder="暱稱"
                        maxLength={100}
                      />
                    </div>
                    <div className={styles.levelRow} style={{ marginBottom: 0 }}>
                      <label htmlFor={`gf-lv-${g.key}`}>級數</label>
                      <input
                        id={`gf-lv-${g.key}`}
                        type="range"
                        min={1}
                        max={18}
                        value={g.level}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setGuestRows((prev) => prev.map((x) => (x.key === g.key ? { ...x, level: n } : x)))
                        }}
                      />
                      <span className={styles.levelValue}>{g.level}</span>
                    </div>
                    <div>
                      {guestRows.length > 1 ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setGuestRows((prev) => prev.filter((x) => x.key !== g.key))}
                        >
                          移除
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}> </span>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setGuestRows((prev) => [...prev, newGuestFormRow()])}
                  >
                    新增一位朋友
                  </button>
                  <button
                    type="button"
                    className={`btn btn-primary ${styles.signupBtn}`}
                    style={{ minWidth: 140 }}
                    onClick={() => void handleGuestSignup()}
                    disabled={actionLoading || !isSignupOpen}
                  >
                    {actionLoading ? '處理中...' : '送出朋友報名'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {myRecord ? (
          <div className={styles.successBox}>
            <span className={styles.successIcon}>✅</span>
            <div>
              <div className={styles.successTitle}>您已報名此場次</div>
              <div className={styles.successStatus}>
                目前狀態：{myRecord.status === 'waitlist' ? `候補第 ${myRecord.waitlist_order} 順位` : '正選名單'}
              </div>
            </div>
          </div>
        ) : null}

        {managedRows.length > 0 ? (
          <div className={styles.successBox} style={{ marginTop: 12 }}>
            <span className={styles.successIcon}>👥</span>
            <div style={{ flex: 1 }}>
              <div className={styles.successTitle}>您已協助報名的球友</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {managedRows.map((r) => (
                  <li key={r.session_participant_id || `${r.display_name}-${r.waitlist_order}`} style={{ marginBottom: 8 }}>
                    <span>
                      {r.display_name}
                      {r.guest_level != null ? `（${r.guest_level} 級）` : ''}
                    </span>
                    {r.session_participant_id ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ marginLeft: 10 }}
                        disabled={actionLoading}
                        onClick={() => void handleCancelManagedGuest(r.session_participant_id!)}
                      >
                        取消這位
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {!user ? (
          <div className={styles.noticeBox}>
            <span className={styles.noticeIcon}>🔒</span>
            <div>
              <div className={styles.noticeTitle}>請先登入才能報名</div>
              <div className={styles.noticeDesc}>
                為確保名單異動可透過 LINE 推播通知到本人，本平台已改為「登入後才能報名」。登入後即可綁定 LINE 並接收通知。
              </div>
              <div style={{ marginTop: '12px' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void startLineLogin()}>
                  使用 LINE 登入並報名
                </button>
                <Link
                  href={`/login?returnTo=${encodeURIComponent(`/s/${code}`)}`}
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 10 }}
                >
                  其他方式登入
                </Link>
              </div>
            </div>
          </div>
        ) : !playerInfo ? (
          <div className={styles.noticeBox}>
            <span className={styles.noticeIcon}>👤</span>
            <div>
              <div className={styles.noticeTitle}>請先建立球員資料</div>
              <div className={styles.noticeDesc}>
                為了讓主辦可以針對您本人推播通知（候補遞補、名單異動），需要先建立一筆球員資料。
              </div>
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={creatingPlayer}
                  onClick={() => {
                    if (!user) return
                    setCreatingPlayer(true)
                    void (async () => {
                      const res = await fetch('/api/players/ensure-self', { method: 'POST' })
                      const j = (await res.json().catch(() => null)) as
                        | { ok: boolean; error?: string; detail?: string }
                        | null
                      if (!res.ok || !j?.ok) {
                        const msg = j?.detail || j?.error || `HTTP ${res.status}`
                        if (msg === 'service_role_not_configured') {
                          throw new Error('伺服端尚未設定 SUPABASE_SERVICE_ROLE_KEY，無法建立球員資料')
                        }
                        throw new Error(`建立球員資料失敗：${msg}`)
                      }
                      await loadSession()
                    })()
                      .catch((e) => {
                        alert(e instanceof Error ? e.message : '建立球員資料失敗，請稍後再試')
                      })
                      .finally(() => setCreatingPlayer(false))
                  }}
                >
                  {creatingPlayer ? '建立中…' : '建立球員資料'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <section className={styles.rosterSection} aria-labelledby="roster-heading">
        <h2 id="roster-heading" className={styles.rosterHeading}>
          名單預覽
        </h2>
        <p className={styles.rosterHint}>正選與候補僅顯示暱稱；若名單為空，請主辦確認已於 Supabase 套用 038 migration（公開名單 RPC）。</p>
        <div className={styles.rosterGrid}>
          <div className={styles.rosterCard}>
            <h3 className={styles.rosterSubhead}>正選 ({mainCount})</h3>
            <ul className={styles.rosterList}>
              {rosterRows
                .filter((r) => r.roster_kind === 'main')
                .map((r, i) => (
                  <li key={`m-${i}-${r.display_name}`} className={styles.rosterItem}>
                    <span>
                      {`${i + 1}. ${r.display_name}`}
                      {r.guest_level != null ? `（${r.guest_level} 級）` : ''}
                    </span>
                    {r.is_self ? <span className={styles.rosterYou}>（您）</span> : null}
                    {r.is_managed_by_registrar ? <span className={styles.rosterYou}>（您代報）</span> : null}
                  </li>
                ))}
              {mainCount === 0 && <li className={styles.rosterEmpty}>尚無正選</li>}
            </ul>
          </div>
          <div className={styles.rosterCard}>
            <h3 className={styles.rosterSubhead}>候補 ({waitlistCount})</h3>
            <ul className={styles.rosterList}>
              {rosterRows
                .filter((r) => r.roster_kind === 'waitlist')
                .sort((a, b) => (a.waitlist_order || 0) - (b.waitlist_order || 0))
                .map((r, i) => (
                  <li key={`w-${i}-${r.display_name}-${r.waitlist_order}`} className={styles.rosterItem}>
                    <span>
                      {`候補 ${i + 1}. ${r.display_name}`}
                      {r.guest_level != null ? `（${r.guest_level} 級）` : ''}
                    </span>
                    {r.is_self ? <span className={styles.rosterYou}>（您）</span> : null}
                    {r.is_managed_by_registrar ? <span className={styles.rosterYou}>（您代報）</span> : null}
                  </li>
                ))}
              {waitlistCount === 0 && <li className={styles.rosterEmpty}>尚無候補</li>}
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}
