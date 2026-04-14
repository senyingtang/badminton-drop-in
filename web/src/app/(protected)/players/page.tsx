'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import PlayerCard from '@/components/players/PlayerCard'
import styles from './players.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HPP = any

interface HostProfileRpcRow {
  id: string
  host_user_id: string
  player_id: string
  self_level: number | null
  host_confirmed_level: number | null
  default_level_adjustment: number
  warning_status: string
  is_blacklisted: boolean
  private_note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  player_code: string | null
  display_name: string | null
}

export default function PlayersPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [profiles, setProfiles] = useState<HPP[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user) return

    const fetch = async () => {
      setLoading(true)
      setLoadError(null)
      const { data, error } = await supabase.rpc('list_host_player_profiles_for_self')
      if (error) {
        console.error('list_host_player_profiles_for_self failed:', error)
        setLoadError(
          error.message?.includes('Could not find') || error.message?.includes('does not exist')
            ? '請在 Supabase 執行 docs/025_list_host_player_profiles_for_self_rpc.sql 後重新整理。'
            : error.message
        )
        setProfiles([])
        setLoading(false)
        return
      }
      const rows = (data || []) as HostProfileRpcRow[]
      const mapped: HPP[] = rows.map((r) => ({
        id: r.id,
        host_user_id: r.host_user_id,
        player_id: r.player_id,
        self_level: r.self_level,
        host_confirmed_level: r.host_confirmed_level,
        default_level_adjustment: r.default_level_adjustment,
        warning_status: r.warning_status,
        is_blacklisted: r.is_blacklisted,
        private_note: r.private_note,
        is_active: r.is_active,
        created_at: r.created_at,
        updated_at: r.updated_at,
        players: {
          id: r.player_id,
          player_code: r.player_code,
          display_name: r.display_name,
        },
      }))
      setProfiles(mapped)
      setLoading(false)
    }

    fetch()
  }, [user, supabase])

  const filtered = search.trim()
    ? profiles.filter((hpp: HPP) => {
        const q = search.toLowerCase()
        return (
          hpp.players?.display_name?.toLowerCase().includes(q) ||
          hpp.players?.player_code?.toLowerCase().includes(q)
        )
      })
    : profiles

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>球員名單</h1>
          <p className={styles.subtitle}>場次報名或加入名單的球員會自動列入；可在此檢視代碼與級數</p>
        </div>
      </div>

      {loadError && (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      )}

      <div className={styles.searchRow}>
        <input
          type="text"
          className="input"
          placeholder="搜尋球員代碼或名稱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className={styles.count}>{filtered.length} 人</span>
      </div>

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>👥</span>
          <p>{search ? '找不到符合的球員' : '尚未建立球員名單'}</p>
          <p className={styles.emptyHint}>
            球員透過分享連結報名或加入場次後，會自動出現在您的名單；若仍為空，請確認已執行 docs/034_signup_player_code_and_host_profile_auto.sql。
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((hpp: HPP) => (
            <PlayerCard
              key={hpp.id}
              playerId={hpp.players?.id}
              displayName={hpp.players?.display_name || ''}
              playerCode={hpp.players?.player_code || ''}
              level={hpp.host_confirmed_level}
              warningStatus={hpp.warning_status}
            />
          ))}
        </div>
      )}
    </div>
  )
}
