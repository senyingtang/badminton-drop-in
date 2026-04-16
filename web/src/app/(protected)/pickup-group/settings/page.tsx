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
  rented_courts_display_mode: 'below' | 'inline'
  theme_preset: string
  theme_custom: {
    brand_start?: string
    brand_end?: string
    bg_primary?: string
    bg_secondary?: string
    text_primary?: string
    text_secondary?: string
  } | null
}

const empty: Row = {
  logo_url: null,
  group_name: '',
  owner_display_name: '',
  intro: null,
  location: '',
  rented_courts_display_mode: 'below',
  theme_preset: 'indigo',
  theme_custom: null,
}

const themePresets: { id: string; label: string }[] = [
  { id: 'indigo', label: '靛紫（預設）' },
  { id: 'emerald', label: '翡翠綠' },
  { id: 'sunset', label: '夕陽橘粉' },
  { id: 'ocean', label: '海洋藍青' },
  { id: 'mono', label: '黑白極簡' },
  { id: 'custom', label: '自訂調色盤' },
]

export default function PickupGroupSettingsPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Row>(empty)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [tab, setTab] = useState<'brand' | 'display' | 'theme'>('brand')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from('pickup_group_settings')
      .select('logo_url, group_name, owner_display_name, intro, location, rented_courts_display_mode, theme_preset, theme_custom')
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
        rented_courts_display_mode: (data.rented_courts_display_mode as 'below' | 'inline') ?? 'below',
        theme_preset: (data.theme_preset as string) ?? 'indigo',
        theme_custom: (data.theme_custom as Row['theme_custom']) ?? null,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      rented_courts_display_mode: form.rented_courts_display_mode,
      theme_preset: form.theme_preset,
      theme_custom: form.theme_preset === 'custom' ? (form.theme_custom ?? {}) : {},
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
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>臨打團後台設定</h1>
        <p className={styles.subtitle}>管理公開報名頁的顯示方式、主題配色與臨打團品牌資訊。</p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.side}>
          <button className={`${styles.tabBtn} ${tab === 'brand' ? styles.tabBtnOn : ''}`} onClick={() => setTab('brand')}>
            品牌資訊
          </button>
          <button className={`${styles.tabBtn} ${tab === 'display' ? styles.tabBtnOn : ''}`} onClick={() => setTab('display')}>
            顯示設定
          </button>
          <button className={`${styles.tabBtn} ${tab === 'theme' ? styles.tabBtnOn : ''}`} onClick={() => setTab('theme')}>
            主題配色
          </button>
        </aside>

        <section className={styles.main}>
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
              {tab === 'brand' && (
                <>
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
                      onChange={(e) => setForm((f) => ({ ...f, intro: e.target.value || null }))}
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
                </>
              )}

              {tab === 'display' && (
                <>
                  <div className={styles.sectionTitle}>租借場地顯示方式</div>
                  <label className={styles.field}>
                    <span className={styles.label}>顯示模式</span>
                    <span className={styles.hint}>影響公開報名頁（分享連結）中的「租借場地」呈現。</span>
                    <select
                      className={styles.input}
                      value={form.rented_courts_display_mode}
                      onChange={(e) => setForm((f) => ({ ...f, rented_courts_display_mode: e.target.value as 'below' | 'inline' }))}
                    >
                      <option value="below">顯示在「場地數量」下面（較清楚）</option>
                      <option value="inline">顯示在「場地數量」後面括弧（省空間）</option>
                    </select>
                  </label>
                </>
              )}

              {tab === 'theme' && (
                <>
                  <div className={styles.sectionTitle}>整體顏色配置</div>
                  <label className={styles.field}>
                    <span className={styles.label}>推薦配色</span>
                    <span className={styles.hint}>選擇一鍵主題，或切換到「自訂調色盤」。</span>
                    <select
                      className={styles.input}
                      value={form.theme_preset}
                      onChange={(e) => setForm((f) => ({ ...f, theme_preset: e.target.value }))}
                    >
                      {themePresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {form.theme_preset === 'custom' && (
                    <div className={styles.paletteGrid}>
                      {([
                        ['brand_start', '品牌色（起）'],
                        ['brand_end', '品牌色（迄）'],
                        ['bg_primary', '背景（主）'],
                        ['bg_secondary', '背景（次）'],
                        ['text_primary', '文字（主）'],
                        ['text_secondary', '文字（次）'],
                      ] as const).map(([k, label]) => (
                        <label key={k} className={styles.paletteItem}>
                          <span className={styles.label}>{label}</span>
                          <input
                            type="text"
                            className={styles.input}
                            placeholder="例：#8b5cf6"
                            value={(form.theme_custom?.[k] as string | undefined) ?? ''}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                theme_custom: { ...(f.theme_custom ?? {}), [k]: e.target.value || undefined },
                              }))
                            }
                          />
                        </label>
                      ))}
                      <p className={styles.hint}>
                        建議填 HEX（#RRGGBB）。留空表示使用系統預設值。
                      </p>
                    </div>
                  )}
                </>
              )}

              {error && <p className={styles.err}>{error}</p>}
              {savedOk && <p className={styles.ok}>已儲存</p>}

              <div className={styles.actions}>
                <button type="submit" className={styles.primary} disabled={saving}>
                  {saving ? '儲存中…' : '儲存'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  )
}
