'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from './share.module.css'
import { useUser } from '@/hooks/useUser'
import { getRentedCourtsDisplay } from '@/lib/rented-courts'
import { getShuttlecockBrandFromSession, getShuttlecockOptionFromSession } from '@/lib/shuttlecock'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

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
  const { user } = useUser()

  const [session, setSession] = useState<Row | null>(null)
  const [participants, setParticipants] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [venue, setVenue] = useState<Row | null>(null)
  const [playerInfo, setPlayerInfo] = useState<Row | null>(null)
  const [selfLevel, setSelfLevel] = useState(6)
  const [guestDisplayName, setGuestDisplayName] = useState('')
  const [guestPlayerCode, setGuestPlayerCode] = useState('')
  const [guestNote, setGuestNote] = useState('')
  const [guestSignupOk, setGuestSignupOk] = useState<{
    status: string
    waitlist_order: number | null
    display_name: string
    player_code?: string | null
  } | null>(null)

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
      const { data: v } = await supabase
        .from('venues')
        .select('name, full_address, google_maps_url, contact_phone')
        .eq('id', sessionData.venue_id)
        .single()
      setVenue(v)
    } else {
      setVenue(null)
    }

    const { data: sps } = await supabase
      .from('session_participants')
      .select(`
          id, player_id, status, waitlist_order, priority_order,
          players(display_name)
        `)
      .eq('session_id', sessionData.id)
      .eq('is_removed', false)

    setParticipants(sps || [])

    if (user) {
      const { data: pData } = await supabase
        .from('players')
        .select('*')
        .eq('auth_user_id', user.id)
        .single()
      setPlayerInfo(pData)
    } else {
      setPlayerInfo(null)
    }

    setLoading(false)
  }, [code, supabase, user])

  useEffect(() => {
    setLoading(true)
    void loadSession()
  }, [loadSession])

  const rpcErrorMessage = (err: unknown): string => {
    const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : ''
    if (msg.includes('session_not_found_or_closed')) return '找不到場次或目前未開放報名'
    if (msg.includes('invalid_display_name')) return '請填寫有效的顯示名稱（1–100 字）'
    if (msg.includes('invalid_code')) return '報名連結無效'
    if (msg.includes('duplicate_name')) return '此場次已有人使用相同顯示名稱報名，請更換名稱'
    if (msg.includes('duplicate_player_code')) return '此球員代碼已被使用，請換一個'
    if (msg.includes('invalid_player_code')) return '球員代碼須為 3–30 個英數字（可留空由系統產生）'
    return '報名失敗，請稍後再試'
  }

  const handleSignup = async () => {
    if (!session || !code) return

    if (!user) {
      const name = guestDisplayName.trim()
      if (!name) {
        alert('請填寫顯示名稱（暱稱）')
        return
      }

      setActionLoading(true)
      try {
        const { data, error } = await supabase.rpc('signup_via_share_code', {
          p_share_code: code,
          p_display_name: name,
          p_self_level: selfLevel,
          p_signup_note: guestNote.trim() || null,
          p_desired_player_code: guestPlayerCode.trim() || null,
        })

        if (error) throw error

        const row = data as {
          ok?: boolean
          status?: string
          waitlist_order?: number | null
          display_name?: string
        }
        if (!row?.ok) throw new Error('signup_failed')

        setGuestSignupOk({
          status: row.status || 'confirmed_main',
          waitlist_order: row.waitlist_order ?? null,
          display_name: row.display_name || name,
          player_code: (row as { player_code?: string }).player_code ?? null,
        })
        await loadSession()
      } catch (err) {
        console.error(err)
        alert(rpcErrorMessage(err))
      } finally {
        setActionLoading(false)
      }
      return
    }

    if (!playerInfo) {
      alert('請先在系統內建立您的球員資料！(可在登入後自動帶入)')
      return
    }

    setActionLoading(true)

    try {
      const existing = participants.find((p) => p.player_id === playerInfo.id)
      if (existing) {
        alert('您已經在報名名單中了！')
        return
      }

      const cap = sessionMaxParticipants(session)
      const activeCount = participants.filter((p) =>
        ['confirmed_main', 'promoted_from_waitlist'].includes(p.status)
      ).length
      const isWaitlist = cap != null && cap > 0 && activeCount >= cap

      const newStatus = isWaitlist ? 'waitlist' : 'confirmed_main'

      let waitlistOrder = null
      if (isWaitlist) {
        const wl = participants.filter((p) => p.status === 'waitlist')
        const maxOrder = wl.length > 0 ? Math.max(...wl.map((p) => p.waitlist_order || 0)) : 0
        waitlistOrder = maxOrder + 1
      }

      const { error } = await supabase.from('session_participants').insert({
        session_id: session.id,
        player_id: playerInfo.id,
        source_type: 'self_signup',
        status: newStatus,
        waitlist_order: waitlistOrder,
        self_level: selfLevel,
      })

      if (error) throw error

      alert(isWaitlist ? '已成功列入候補名單！' : '報名成功！已進入正選名單。')

      window.location.reload()
    } catch (err) {
      console.error(err)
      alert('報名失敗，請稍後再試')
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
  const mainCount = participants.filter((p) =>
    ['confirmed_main', 'promoted_from_waitlist'].includes(p.status)
  ).length
  const waitlistCount = participants.filter((p) => p.status === 'waitlist').length

  const myRecord = playerInfo ? participants.find((p) => p.player_id === playerInfo.id) : null

  const signupOpenStatuses = [
    'pending_confirmation',
    'ready_for_assignment',
    'assigned',
    'in_progress',
    'round_finished',
  ]
  const isSignupOpen = signupOpenStatuses.includes(session.status)

  return (
    <div className={styles.container}>
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
              <div className={styles.shuttleTagline}>{shuttleOpt.hintZh}</div>
            </div>
          </div>
          {rentedCourtsDisplay && (
            <div className={styles.infoRow}>
              <span className={styles.icon}>🥅</span>
              <div>
                <div className={styles.label}>租借場地</div>
                <div className={styles.value}>{rentedCourtsDisplay}</div>
              </div>
            </div>
          )}
          <div className={styles.infoRow}>
            <span className={styles.icon}>🏸</span>
            <div>
              <div className={styles.label}>場地數量</div>
              <div className={styles.value}>{session.court_count} 面</div>
            </div>
          </div>
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
            
            {venue.full_address && (
              <div className={styles.venueItem}>
                <span className={styles.vIcon}>📍</span>
                <span className={styles.vText}>{venue.full_address}</span>
              </div>
            )}
            {venue.contact_phone && (
              <div className={styles.venueItem}>
                <span className={styles.vIcon}>📞</span>
                <span className={styles.vText}>{venue.contact_phone}</span>
              </div>
            )}
            {venue.google_maps_url && (
              <a href={venue.google_maps_url} target="_blank" rel="noreferrer" className={styles.mapLink}>
                🗺️ 開啟 Google Maps
              </a>
            )}
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
        {!user && !guestSignupOk && (
          <div className={styles.guestFields}>
            <label className={styles.guestLabel} htmlFor="guestName">
              顯示名稱（暱稱）<span className={styles.req}>*</span>
            </label>
            <input
              id="guestName"
              className={styles.guestInput}
              type="text"
              autoComplete="name"
              placeholder="例如：小陳"
              value={guestDisplayName}
              onChange={(e) => setGuestDisplayName(e.target.value)}
              maxLength={100}
            />
            <label className={styles.guestLabel} htmlFor="guestPlayerCode">
              球員代碼（選填，英數 3–30 字，全站唯一；留空則由系統產生）
            </label>
            <input
              id="guestPlayerCode"
              className={styles.guestInput}
              type="text"
              autoComplete="off"
              placeholder="例如：chenbad2025"
              value={guestPlayerCode}
              onChange={(e) => setGuestPlayerCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
              maxLength={30}
            />
            <label className={styles.guestLabel} htmlFor="guestNote">
              備註（選填，電話或留言給主辦）
            </label>
            <input
              id="guestNote"
              className={styles.guestInput}
              type="text"
              autoComplete="off"
              placeholder="選填"
              value={guestNote}
              onChange={(e) => setGuestNote(e.target.value)}
              maxLength={500}
            />
          </div>
        )}
        {isSignupOpen && ((user && playerInfo && !myRecord) || (!user && !guestSignupOk)) && (
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
        ) : guestSignupOk ? (
          <div className={styles.successBox}>
            <span className={styles.successIcon}>✅</span>
            <div>
              <div className={styles.successTitle}>報名成功</div>
              <div className={styles.successStatus}>
                {guestSignupOk.display_name}
                {guestSignupOk.player_code ? ` · 代碼：${guestSignupOk.player_code}` : ''} —{' '}
                {guestSignupOk.status === 'waitlist'
                  ? `候補第 ${guestSignupOk.waitlist_order} 順位`
                  : '已進入正選名單'}
              </div>
            </div>
          </div>
        ) : (
          <button
            className={`btn btn-primary ${styles.signupBtn}`}
            onClick={handleSignup}
            disabled={
              actionLoading || !isSignupOpen || (!!user && !playerInfo)
            }
          >
            {actionLoading
              ? '處理中...'
              : user && !playerInfo
                ? '請先建立球員資料'
                : '送出報名'}
          </button>
        )}
      </div>
    </div>
  )
}
