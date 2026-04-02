'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import Modal from '@/components/ui/Modal'
import styles from './AddParticipantModal.module.css'

interface AddParticipantModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlayerRow = any

export default function AddParticipantModal({ isOpen, onClose, sessionId }: AddParticipantModalProps) {
  const supabase = createClient()
  const { user } = useUser()

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlayerRow[]>([])
  const [searching, setSearching] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  // Create new player
  const [showCreate, setShowCreate] = useState(false)
  const [newPlayerCode, setNewPlayerCode] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newLevel, setNewLevel] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setError(null)

    const { data } = await supabase
      .from('players')
      .select('id, player_code, display_name')
      .or(`player_code.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
      .eq('is_active', true)
      .limit(10)

    setSearchResults(data || [])
    setSearching(false)
  }

  const handleAddPlayer = async (playerId: string) => {
    if (!user) return
    setError(null)

    try {
      // Check if host_player_profile exists
      const { data: hpp } = await supabase
        .from('host_player_profiles')
        .select('id')
        .eq('host_user_id', user.id)
        .eq('player_id', playerId)
        .single()

      const { error: insertErr } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionId,
          player_id: playerId,
          host_player_profile_id: hpp?.id || null,
          source_type: 'host_manual',
          status: 'confirmed_main',
        })

      if (insertErr) {
        if (insertErr.code === '23505') {
          setError('此球員已在名單中')
        } else {
          setError(insertErr.message)
        }
        return
      }

      setAddedIds((prev) => new Set(prev).add(playerId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失敗')
    }
  }

  const handleCreateAndAdd = async () => {
    if (!user) return
    if (!newPlayerCode.trim() || !newDisplayName.trim()) {
      setError('代碼和名稱為必填')
      return
    }
    setCreateLoading(true)
    setError(null)

    try {
      // Create player
      const { data: newPlayer, error: playerErr } = await supabase
        .from('players')
        .insert({
          player_code: newPlayerCode.trim().toLowerCase(),
          display_name: newDisplayName.trim(),
        })
        .select('id')
        .single()

      if (playerErr) {
        if (playerErr.code === '23505') {
          setError('此代碼已被使用')
        } else {
          setError(playerErr.message)
        }
        setCreateLoading(false)
        return
      }

      // Create host_player_profile
      const level = newLevel ? parseInt(newLevel) : null
      await supabase.from('host_player_profiles').insert({
        host_user_id: user.id,
        player_id: newPlayer.id,
        self_level: level,
        host_confirmed_level: level,
      })

      // Add to session
      await supabase.from('session_participants').insert({
        session_id: sessionId,
        player_id: newPlayer.id,
        source_type: 'host_manual',
        status: 'confirmed_main',
        self_level: level,
        session_effective_level: level,
      })

      // Reset form
      setNewPlayerCode('')
      setNewDisplayName('')
      setNewLevel('')
      setShowCreate(false)
      setAddedIds((prev) => new Set(prev).add(newPlayer.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗')
    } finally {
      setCreateLoading(false)
    }
  }

  const handleClose = () => {
    setSearchQuery('')
    setSearchResults([])
    setAddedIds(new Set())
    setShowCreate(false)
    setError(null)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="新增球員" size="md">
      <div className={styles.content}>
        {error && <div className={styles.error}>{error}</div>}

        {/* Search */}
        <div className={styles.searchRow}>
          <input
            type="text"
            className="input"
            placeholder="搜尋球員代碼或名稱..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
            {searching ? '...' : '搜尋'}
          </button>
        </div>

        {/* Results */}
        {searchResults.length > 0 && (
          <div className={styles.results}>
            {searchResults.map((player: PlayerRow) => (
              <div key={player.id} className={styles.resultRow}>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>{player.display_name}</span>
                  <span className={styles.resultCode}>{player.player_code}</span>
                </div>
                {addedIds.has(player.id) ? (
                  <span className={styles.addedTag}>✓ 已加入</span>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleAddPlayer(player.id)}
                  >
                    加入
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {searchResults.length === 0 && searchQuery && !searching && (
          <p className={styles.noResult}>找不到符合的球員</p>
        )}

        {/* Divider */}
        <div className={styles.divider}>
          <span>或</span>
        </div>

        {/* Create new player */}
        {!showCreate ? (
          <button
            className={`btn btn-ghost ${styles.createToggle}`}
            onClick={() => setShowCreate(true)}
          >
            ＋ 建立新球員
          </button>
        ) : (
          <div className={styles.createForm}>
            <h4 className={styles.createTitle}>建立新球員</h4>
            <div className={styles.createFields}>
              <div className={styles.createRow}>
                <input
                  type="text"
                  className="input"
                  placeholder="球員代碼（英數字）*"
                  value={newPlayerCode}
                  onChange={(e) => setNewPlayerCode(e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="顯示名稱 *"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                />
              </div>
              <input
                type="number"
                className="input"
                placeholder="級數（1-18，選填）"
                min={1}
                max={18}
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
              />
            </div>
            <div className={styles.createActions}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCreate(false)}
              >
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateAndAdd}
                disabled={createLoading}
              >
                {createLoading ? '建立中...' : '建立並加入'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
