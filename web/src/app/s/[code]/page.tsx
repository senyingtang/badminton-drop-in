'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from './share.module.css'
import { useUser } from '@/hooks/useUser'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export default function PublicSessionPage() {
  const { code } = useParams()
  const router = useRouter()
  const supabase = createClient()
  const { user } = useUser()

  const [session, setSession] = useState<Row | null>(null)
  const [participants, setParticipants] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [venue, setVenue] = useState<Row | null>(null)
  const [playerInfo, setPlayerInfo] = useState<Row | null>(null)

  useEffect(() => {
    const fetchSession = async () => {
      // 1. Fetch Session
      const { data: sessionData, error: sessionErr } = await supabase
        .from('sessions')
        .select('*')
        .eq('share_signup_code', code)
        .single()

      if (sessionErr || !sessionData) {
        setSession(null)
        setLoading(false)
        return
      }

      setSession(sessionData)

      // 2. Fetch Venue
      if (sessionData.venue_id) {
        const { data: v } = await supabase
          .from('venues')
          .select('name, full_address, google_maps_url, contact_phone')
          .eq('id', sessionData.venue_id)
          .single()
        setVenue(v)
      }

      // 3. Fetch Participants
      const { data: sps } = await supabase
        .from('session_participants')
        .select(`
          id, player_id, status, waitlist_order, priority_order,
          players(display_name)
        `)
        .eq('session_id', sessionData.id)
        .eq('is_removed', false)
      
      setParticipants(sps || [])

      // 4. Fetch the logged-in user's player record if logged in
      if (user) {
        const { data: pData } = await supabase
          .from('players')
          .select('*')
          .eq('user_id', user.id)
          .single()
        setPlayerInfo(pData)
      }

      setLoading(false)
    }

    if (code) fetchSession()
  }, [code, supabase, user])

  const handleSignup = async () => {
    if (!user) {
      // Redir to login, but pass a returnTo param
      router.push(`/login?returnTo=/s/${code}`)
      return
    }

    if (!session) return

    if (!playerInfo) {
      alert('請先在系統內建立您的球員資料！(可在登入後自動帶入)')
      return
    }

    setActionLoading(true)

    try {
      // Check if already signed up
      const existing = participants.find(p => p.player_id === playerInfo.id)
      if (existing) {
        alert('您已經在報名名單中了！')
        return
      }

      // Determine regular or waitlist
      const activeCount = participants.filter(p => p.status === 'confirmed_main').length
      const isWaitlist = session.max_participants && activeCount >= session.max_participants
      
      const newStatus = isWaitlist ? 'waitlist' : 'confirmed_main'

      // We need to calculate waitlist order if it's a waitlist
      let waitlistOrder = null
      if (isWaitlist) {
        const wl = participants.filter(p => p.status === 'waitlist')
        const maxOrder = wl.length > 0 ? Math.max(...wl.map(p => p.waitlist_order || 0)) : 0
        waitlistOrder = maxOrder + 1
      }

      // We should use an RPC in real scenarios safely, but direct insert if RLS allows self signup
      // Wait, direct insert works if RLS allows, but usually we need an RPC to handle the counters.
      // Currently, we will just insert to `session_participants`.
      const { error } = await supabase.from('session_participants').insert({
        session_id: session.id,
        player_id: playerInfo.id,
        source_type: 'app_user',
        status: newStatus,
        waitlist_order: waitlistOrder,
        self_level: 6, // default or let user choose later
      })

      if (error) throw error
      
      alert(isWaitlist ? '已成功列入候補名單！' : '報名成功！已進入正選名單。')
      
      // reload
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

  const mainCount = participants.filter(p => ['confirmed_main', 'promoted_from_waitlist'].includes(p.status)).length
  const waitlistCount = participants.filter(p => p.status === 'waitlist').length

  const myRecord = playerInfo ? participants.find(p => p.player_id === playerInfo.id) : null

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.badge}>{['published','ready_for_assignment'].includes(session.status) ? '報名中' : '準備開打'}</span>
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
                {mainCount} / {session.max_participants || '不限'} 人 (候補 {waitlistCount} 人)
              </div>
            </div>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.icon}>💰</span>
            <div>
              <div className={styles.label}>費用</div>
              <div className={styles.value}>
                {session.fee_twd ? `NT$ ${session.fee_twd}` : '請洽主辦'}
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
        ) : (
          <button 
            className={`btn btn-primary ${styles.signupBtn}`}
            onClick={handleSignup}
            disabled={actionLoading || session.status === 'closed'}
          >
            {actionLoading ? '處理中...' : (!user ? '登入以報名' : '我要報名')}
          </button>
        )}
      </div>
    </div>
  )
}
