'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './CourtManager.module.css'

interface Court {
  id: string
  court_no: number
  name: string
  intensity_label?: string
}

interface CourtManagerProps {
  venueId: string
  initialCourts: Court[]
}

export default function CourtManager({ venueId, initialCourts }: CourtManagerProps) {
  const supabase = createClient()
  const [courts, setCourts] = useState<Court[]>(initialCourts.sort((a, b) => a.court_no - b.court_no))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAddCourt = async () => {
    setLoading(true)
    setError(null)
    const nextNo = courts.length > 0 ? Math.max(...courts.map(c => c.court_no)) + 1 : 1
    const courtName = `${nextNo}號場`

    const { data, error: err } = await supabase
      .from('courts')
      .insert({
        venue_id: venueId,
        court_no: nextNo,
        name: courtName
      })
      .select()
      .single()

    if (err) {
      setError('新增場地失敗')
      console.error(err)
    } else {
      setCourts([...courts, data].sort((a, b) => a.court_no - b.court_no))
    }
    setLoading(false)
  }

  const handleRemoveCourt = async (courtId: string) => {
    if (!confirm('確定要刪除此場地嗎？相關的比賽記錄可能受影響。')) return
    setLoading(true)
    setError(null)

    const { error: err } = await supabase
      .from('courts')
      .delete()
      .eq('id', courtId)

    if (err) {
      setError('刪除場地失敗')
      console.error(err)
    } else {
      setCourts(courts.filter(c => c.id !== courtId))
    }
    setLoading(false)
  }

  const handleUpdateName = async (courtId: string, newName: string) => {
    const { error: err } = await supabase
      .from('courts')
      .update({ name: newName })
      .eq('id', courtId)

    if (err) {
      console.error(err)
    } else {
      setCourts(courts.map(c => c.id === courtId ? { ...c, name: newName } : c))
    }
  }

  return (
    <div className={styles.manager}>
      <div className={styles.header}>
        <h3 className={styles.title}>球場配置 ({courts.length})</h3>
        <button 
          className="btn btn-ghost btn-sm" 
          onClick={handleAddCourt}
          disabled={loading}
        >
          ＋ 新增球場
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list}>
        {courts.map((court) => (
          <div key={court.id} className={styles.item}>
            <div className={styles.number}>#{court.court_no}</div>
            <input 
              type="text" 
              className={styles.input} 
              value={court.name} 
              onBlur={(e) => handleUpdateName(court.id, e.target.value)}
              onChange={(e) => setCourts(courts.map(c => c.id === court.id ? { ...c, name: e.target.value } : c))}
            />
            <button 
              className={styles.removeBtn} 
              onClick={() => handleRemoveCourt(court.id)}
              disabled={loading}
              title="刪除球場"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {courts.length === 0 && (
        <p className={styles.empty}>目前沒有球場，請點擊上方按鈕新增。</p>
      )}
    </div>
  )
}
