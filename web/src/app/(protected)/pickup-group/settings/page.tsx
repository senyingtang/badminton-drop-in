'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './settings.module.css'

type Row = {
  logo_url: string | null
  group_name: string
  owner_display_name: string
  intro: string | null
  location: string
}

const empty: Row = {
  logo_url: null,
  group_name: '',
  owner_display_name: '',
  intro: null,
  location: '',
}

export default function PickupGroupSettingsPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Row>(empty)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from('pickup_group_settings')
      .select('logo_url, group_name, owner_display_name, intro, location')
      .eq('host_user_id', user.id)
      .maybeSingle()

    if (qErr) {
      setError(qErr.message)
      setLoading(false)
      return
    }

    if (data) {
      setForm({
        logo_url: data.logo_url,
        group_name: data.group_name ?? '',
        owner_display_name: data.owner_display_name ?? '',
        intro: data.intro,
        location: data.location ?? '',
      })
    } else {
      const { data: prof } = await supabase
        .from('app_user_profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle()
      setForm({
        ...empty,
        owner_display_name: prof?.display_name?.trim() ?? '',
      })
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    if (!user) return
    const groupName = form.group_name.trim()
    const owner = form.owner_display_name.trim()
    const location = form.location.trim()
    if (!groupName || !owner || !location) {
      setError('請填寫團名、團主與開設地點（必填欄位）')
      return
    }
    setSaving(true)
    setError(null)
    setSavedOk(false)

    const payload = {
      host_user_id: user.id,
      logo_url: form.logo_url?.trim() || null,
      group_name: groupName,
      owner_display_name: owner,
      intro: form.intro?.trim() || null,
      location,
      updated_at: new Date().toISOString(),
    }

    const { error: upErr } = await supabase.from('pickup_group_settings').upsert(payload, {
      onConflict: 'host_user_id',
    })

    setSaving(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 3000)
  }

  if (!user) return null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>臨打團設置</h1>
        <p className={styles.subtitle}>公開給球友辨識你的臨打團資訊（之後可用於分享頁或名冊）。</p>
      </header>

      {loading ? (
        <p className={styles.muted}>載入中…</p>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
          <label className={styles.field}>
            <span className={styles.label}>臨打團 Logo（選填）</span>
            <span className={styles.hint}>圖片網址，可稍後再接上傳</span>
            <input
              type="url"
              className={styles.input}
              placeholder="https://…"
              value={form.logo_url ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value || null }))}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>臨打團團名（必填）</span>
            <input
              type="text"
              className={styles.input}
              required
              value={form.group_name}
              onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>臨打團團主（必填）</span>
            <input
              type="text"
              className={styles.input}
              required
              value={form.owner_display_name}
              onChange={(e) => setForm((f) => ({ ...f, owner_display_name: e.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>臨打團介紹（選填）</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={form.intro ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, intro: e.target.value || null }))
              }
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>臨打團開設地點（必填）</span>
            <input
              type="text"
              className={styles.input}
              required
              placeholder="例：新北市 ○○ 羽球館"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </label>

          {error && <p className={styles.err}>{error}</p>}
          {savedOk && <p className={styles.ok}>已儲存</p>}

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={saving}>
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
