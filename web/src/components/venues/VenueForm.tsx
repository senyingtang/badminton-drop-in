'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './VenueForm.module.css'

interface Venue {
  id: string
  name: string
  description?: string
  address_text?: string
  full_address?: string
  google_maps_url?: string
  contact_phone?: string
  city?: string
  district?: string
  /** 場館已登錄的球場（僅供顯示場地數量，儲存時不送出） */
  courts?: { id: string }[]
}

interface VenueFormProps {
  initialData: Venue
  onUpdate?: (updated: Venue) => void
  /** 優先於 initialData.courts 長度（父層在球場增刪後更新） */
  courtCount?: number
}

export default function VenueForm({ initialData, onUpdate, courtCount: courtCountProp }: VenueFormProps) {
  const supabase = createClient()
  const [formData, setFormData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const { error: err } = await supabase
      .from('venues')
      .update({
        name: formData.name,
        description: formData.description,
        address_text: formData.address_text,
        full_address: formData.full_address,
        google_maps_url: formData.google_maps_url,
        contact_phone: formData.contact_phone,
        city: formData.city,
        district: formData.district
      })
      .eq('id', formData.id)

    if (err) {
      setMessage({ type: 'error', text: '儲存失敗：' + err.message })
    } else {
      setMessage({ type: 'success', text: '場館資訊已更新' })
      if (onUpdate) onUpdate(formData)
    }
    setLoading(false)
  }

  const courtCount = courtCountProp ?? formData.courts?.length ?? 0

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h3 className={styles.title}>基本資訊</h3>

      <div className={styles.venueStat}>
        <span className={styles.venueStatLabel}>場地數量</span>
        <span className={styles.venueStatValue}>{courtCount} 面</span>
        <span className={styles.venueStatHint}>（於右側「球場配置」新增／刪除，與實際可打面數一致）</span>
      </div>
      
      <div className={styles.field}>
        <label>場館名稱 *</label>
        <input 
          type="text" 
          className="input" 
          value={formData.name || ''} 
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label>城市</label>
          <input 
            type="text" 
            className="input" 
            value={formData.city || ''} 
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            placeholder="例：新北市"
          />
        </div>
        <div className={styles.field}>
          <label>行政區</label>
          <input 
            type="text" 
            className="input" 
            value={formData.district || ''} 
            onChange={(e) => setFormData({ ...formData, district: e.target.value })}
            placeholder="例：林口區"
          />
        </div>
      </div>

      <div className={styles.field}>
        <label>詳細地址 (將被顯示在公開頁面)</label>
        <input 
          type="text" 
          className="input" 
          value={formData.full_address || formData.address_text || ''} 
          onChange={(e) => setFormData({ ...formData, full_address: e.target.value })}
          placeholder="例：新北市林口區菁埔39之41號"
        />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label>聯絡電話</label>
          <input 
            type="text" 
            className="input" 
            value={formData.contact_phone || ''} 
            onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
            placeholder="例：02-2601-1234"
          />
        </div>
        <div className={styles.field}>
          <label>Google Maps 網址</label>
          <input 
            type="url" 
            className="input" 
            value={formData.google_maps_url || ''} 
            onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
            placeholder="https://maps.app.goo.gl/..."
          />
        </div>
      </div>

      <div className={styles.field}>
        <label>場館描述</label>
        <textarea 
          className="input" 
          rows={3}
          value={formData.description || ''} 
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="介紹場館設施、交通等資訊..."
        />
      </div>

      {message && (
        <div className={`${styles.message} ${styles[message.type]}`}>
          {message.text}
        </div>
      ) }

      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? '儲存中...' : '儲存變更'}
        </button>
      </div>
    </form>
  )
}
