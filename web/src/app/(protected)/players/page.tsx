'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import PlayerCard from '@/components/players/PlayerCard'
import styles from './players.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HPP = any

export default function PlayersPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [profiles, setProfiles] = useState<HPP[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user) return

    const fetch = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('host_player_profiles')
        .select('*, players(id, player_code, display_name)')
        .eq('host_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      setProfiles(data || [])
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
          <p className={styles.subtitle}>管理您團隊的球員資訊與評價</p>
        </div>
      </div>

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
          <p className={styles.emptyHint}>在場次中新增球員後，會自動出現在此列表</p>
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
