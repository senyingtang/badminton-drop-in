'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import CommissionEventsSection from './CommissionEventsSection'
import styles from './commissions.module.css'

type CommissionItem = {
  id: string
  item_key: string
  display_name: string
  description: string | null
  default_rate: string | number
  is_active: boolean
  sort_order: number
  rate_override_count?: number
}

type ReferrerRow = {
  user_id: string
  email: string | null
  display_name: string | null
  primary_role: string | null
  referral_code: string
  is_active: boolean
  created_at: string
  active_referral_links_count: number
  personal_rate_overrides_count: number
}

type OverrideRow = {
  id: string
  referrer_user_id: string
  commission_item_id: string
  rate: string | number
  is_active: boolean
  note: string | null
}

function pct(n: number): string {
  if (Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

function numRate(v: string | number): number {
  return Number(v)
}

type ItemEditState = {
  display_name: string
  default_rate_percent: string
  is_active: boolean
  sort_order: string
  description: string
}

function defaultItemEdit(it: CommissionItem): ItemEditState {
  const r = numRate(it.default_rate)
  return {
    display_name: it.display_name,
    default_rate_percent: String(Math.round(r * 10000) / 100),
    is_active: it.is_active,
    sort_order: String(it.sort_order),
    description: it.description ?? '',
  }
}

export default function AdminCommissionsPage() {
  const [items, setItems] = useState<CommissionItem[]>([])
  const [referrers, setReferrers] = useState<ReferrerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [itemEdits, setItemEdits] = useState<Record<string, ItemEditState>>({})

  const emptyNewItem = useMemo(
    () => ({
      item_key: '',
      display_name: '',
      description: '',
      default_rate_percent: '10',
      is_active: true,
      sort_order: '100',
    }),
    []
  )
  const [newItem, setNewItem] = useState(emptyNewItem)
  const [savingItemId, setSavingItemId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalReferrer, setModalReferrer] = useState<ReferrerRow | null>(null)
  const [modalItems, setModalItems] = useState<CommissionItem[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalErr, setModalErr] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)

  const [modalEdits, setModalEdits] = useState<
    Record<string, { usePersonal: boolean; ratePercent: string; note: string }>
  >({})

  const loadItems = useCallback(async () => {
    const res = await fetch('/api/admin/commissions/items')
    const j = (await res.json().catch(() => null)) as { ok?: boolean; items?: CommissionItem[]; error?: string } | null
    if (!res.ok || !j?.ok || !j.items) throw new Error(j?.error || `HTTP ${res.status}`)
    setItems(j.items)
    const nextEdits: Record<string, ItemEditState> = {}
    for (const it of j.items) {
      nextEdits[it.id] = defaultItemEdit(it)
    }
    setItemEdits(nextEdits)
  }, [])

  const loadReferrers = useCallback(async () => {
    const res = await fetch('/api/admin/commissions/referrers')
    const j = (await res.json().catch(() => null)) as { ok?: boolean; referrers?: ReferrerRow[]; error?: string } | null
    if (!res.ok || !j?.ok || !j.referrers) throw new Error(j?.error || `HTTP ${res.status}`)
    setReferrers(j.referrers)
  }, [])

  const refresh = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      await Promise.all([loadItems(), loadReferrers()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [loadItems, loadReferrers])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveItemRow = async (row: CommissionItem) => {
    const ed = itemEdits[row.id] ?? defaultItemEdit(row)
    setSavingItemId(row.id)
    setErr(null)
    setToast(null)
    try {
      const pctNum = Number(ed.default_rate_percent)
      if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) throw new Error('比例需在 0–100% 之間')
      const res = await fetch('/api/admin/commissions/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          item_key: row.item_key,
          display_name: ed.display_name.trim(),
          description: (ed.description || '').trim() || null,
          default_rate_percent: pctNum,
          is_active: ed.is_active,
          sort_order: Number(ed.sort_order),
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setToast('已儲存分潤項目')
      await loadItems()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSavingItemId(null)
    }
  }

  const createItem = async () => {
    setErr(null)
    setToast(null)
    const key = newItem.item_key.trim()
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(key)) {
      setErr('item_key 需為英文 snake_case（小寫、底線）')
      return
    }
    const pctNum = Number(newItem.default_rate_percent)
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
      setErr('比例需在 0–100% 之間')
      return
    }
    try {
      const res = await fetch('/api/admin/commissions/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_key: key,
          display_name: newItem.display_name.trim(),
          description: newItem.description.trim() || null,
          default_rate_percent: pctNum,
          is_active: newItem.is_active,
          sort_order: Number(newItem.sort_order),
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setToast('已新增分潤項目')
      setNewItem(emptyNewItem)
      await loadItems()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '新增失敗')
    }
  }

  const openModal = async (r: ReferrerRow) => {
    setModalReferrer(r)
    setModalOpen(true)
    setModalErr(null)
    setModalLoading(true)
    setModalEdits({})
    try {
      const res = await fetch(`/api/admin/commissions/referrer-rates?referrerUserId=${encodeURIComponent(r.user_id)}`)
      const j = (await res.json().catch(() => null)) as
        | { ok?: boolean; commission_items?: CommissionItem[]; overrides?: OverrideRow[]; error?: string }
        | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setModalItems(j.commission_items || [])
      const overrides = j.overrides || []
      const edits: typeof modalEdits = {}
      for (const it of j.commission_items || []) {
        const ov = overrides.find((o) => o.commission_item_id === it.id)
        const defR = numRate(it.default_rate)
        const personalR = ov ? numRate(ov.rate) : defR
        edits[it.id] = {
          usePersonal: ov ? ov.is_active : false,
          ratePercent: String(Math.round((ov && ov.is_active ? personalR : defR) * 10000) / 100),
          note: ov?.note ?? '',
        }
      }
      setModalEdits(edits)
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setModalLoading(false)
    }
  }

  const saveModal = async () => {
    if (!modalReferrer) return
    setModalSaving(true)
    setModalErr(null)
    setToast(null)
    try {
      for (const it of modalItems) {
        const ed = modalEdits[it.id]
        if (!ed) continue
        const pctNum = Number(ed.ratePercent)
        if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) throw new Error(`項目「${it.display_name}」比例無效`)
        const res = await fetch('/api/admin/commissions/referrer-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referrer_user_id: modalReferrer.user_id,
            commission_item_id: it.id,
            rate_percent: pctNum,
            is_active: ed.usePersonal,
            note: ed.note.trim() || null,
          }),
        })
        const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setToast('已儲存個人分潤比例')
      setModalOpen(false)
      await Promise.all([loadItems(), loadReferrers()])
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setModalSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>業務分潤設定</h1>
      <p className={styles.subtitle}>
        Phase 2：分潤項目與個人比例。Phase 3：分潤事件帳本（可查詢、手動測試、作廢與調整）。不接付款 webhook、不做請款。
      </p>

      {err && <div className={styles.error}>{err}</div>}
      {toast && <div className={styles.success}>{toast}</div>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>分潤項目</h2>
        <div className={styles.toolbar}>
          <span className={styles.rowMuted}>新增項目（item_key 建立後請避免任意改名用途）</span>
        </div>
        <div className={styles.tableWrap} style={{ marginBottom: 16 }}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <td>
                  <input
                    className={styles.input}
                    placeholder="item_key（snake_case）"
                    value={newItem.item_key}
                    onChange={(e) => setNewItem((s) => ({ ...s, item_key: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className={styles.input}
                    placeholder="顯示名稱"
                    value={newItem.display_name}
                    onChange={(e) => setNewItem((s) => ({ ...s, display_name: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className={`${styles.input} ${styles.inputNarrow}`}
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    title="百分比，例如 10 = 10%"
                    value={newItem.default_rate_percent}
                    onChange={(e) => setNewItem((s) => ({ ...s, default_rate_percent: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className={`${styles.input} ${styles.inputNarrow}`}
                    type="number"
                    value={newItem.sort_order}
                    onChange={(e) => setNewItem((s) => ({ ...s, sort_order: e.target.value }))}
                  />
                </td>
                <td>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={newItem.is_active}
                      onChange={(e) => setNewItem((s) => ({ ...s, is_active: e.target.checked }))}
                    />
                    啟用
                  </label>
                </td>
                <td>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void createItem()}>
                    新增
                  </button>
                </td>
              </tr>
              <tr>
                <td colSpan={6}>
                  <input
                    className={styles.input}
                    style={{ width: '100%' }}
                    placeholder="說明（選填）"
                    value={newItem.description}
                    onChange={(e) => setNewItem((s) => ({ ...s, description: e.target.value }))}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {loading ? (
          <p className={styles.rowMuted}>載入中…</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>項目名稱</th>
                  <th>item_key</th>
                  <th>預設比例</th>
                  <th>啟用</th>
                  <th>排序</th>
                  <th>個人覆蓋數</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const ed = itemEdits[it.id] ?? defaultItemEdit(it)
                  return (
                    <tr key={it.id}>
                      <td>
                        <input
                          className={styles.input}
                          value={ed.display_name}
                          onChange={(e) =>
                            setItemEdits((prev) => ({
                              ...prev,
                              [it.id]: { ...(prev[it.id] ?? defaultItemEdit(it)), display_name: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className={styles.mono}>{it.item_key}</td>
                      <td>
                        <input
                          className={`${styles.input} ${styles.inputNarrow}`}
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          title="百分比"
                          value={ed.default_rate_percent}
                          onChange={(e) =>
                            setItemEdits((prev) => ({
                              ...prev,
                              [it.id]: { ...(prev[it.id] ?? defaultItemEdit(it)), default_rate_percent: e.target.value },
                            }))
                          }
                        />
                        <span className={styles.rowMuted} style={{ marginLeft: 6 }}>
                          （{pct(numRate(it.default_rate))}）
                        </span>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={ed.is_active}
                          onChange={(e) =>
                            setItemEdits((prev) => ({
                              ...prev,
                              [it.id]: { ...(prev[it.id] ?? defaultItemEdit(it)), is_active: e.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className={`${styles.input} ${styles.inputNarrow}`}
                          value={ed.sort_order}
                          onChange={(e) =>
                            setItemEdits((prev) => ({
                              ...prev,
                              [it.id]: { ...(prev[it.id] ?? defaultItemEdit(it)), sort_order: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>{it.rate_override_count ?? 0}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.btn}
                          disabled={savingItemId === it.id}
                          onClick={() => void saveItemRow(it)}
                        >
                          {savingItemId === it.id ? '儲存中…' : '儲存'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>推薦人 / 業務</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>顯示名稱</th>
                <th>Email</th>
                <th>推薦碼</th>
                <th>身分</th>
                <th>已推薦人數</th>
                <th>個人覆蓋數</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {referrers.map((r) => (
                <tr key={r.user_id}>
                  <td>{r.display_name ?? '—'}</td>
                  <td className={styles.mono}>{r.email ?? '—'}</td>
                  <td className={styles.mono}>{r.referral_code}</td>
                  <td>{r.primary_role ?? '—'}</td>
                  <td>{r.active_referral_links_count}</td>
                  <td>{r.personal_rate_overrides_count}</td>
                  <td>
                    <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void openModal(r)}>
                      設定比例
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CommissionEventsSection />

      {modalOpen && modalReferrer && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>個人分潤比例</h3>
            <p className={styles.rowMuted} style={{ marginBottom: 12 }}>
              {modalReferrer.email ?? '—'} · 推薦碼 {modalReferrer.referral_code}
            </p>
            {modalErr && <div className={styles.error}>{modalErr}</div>}
            {modalLoading ? (
              <p>載入中…</p>
            ) : (
              <>
                {modalItems.map((it) => {
                  const ed = modalEdits[it.id]
                  const defR = numRate(it.default_rate)
                  const defPct = String(Math.round(defR * 10000) / 100)
                  return (
                    <div key={it.id} className={styles.itemRateRow}>
                      <div>
                        <strong>{it.display_name}</strong>
                        <div className={styles.rowMuted}>{it.item_key}</div>
                      </div>
                      <div title="項目預設">{pct(defR)}</div>
                      <div>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={ed?.usePersonal ?? false}
                            onChange={(e) => {
                              const on = e.target.checked
                              setModalEdits((prev) => {
                                const cur = prev[it.id] ?? {
                                  usePersonal: false,
                                  ratePercent: defPct,
                                  note: '',
                                }
                                return {
                                  ...prev,
                                  [it.id]: {
                                    ...cur,
                                    usePersonal: on,
                                    ratePercent: on ? cur.ratePercent || defPct : defPct,
                                  },
                                }
                              })
                            }}
                          />
                          個人
                        </label>
                      </div>
                      <div>
                        <input
                          className={styles.input}
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          disabled={!ed?.usePersonal}
                          value={ed?.ratePercent ?? defPct}
                          onChange={(e) =>
                            setModalEdits((prev) => ({
                              ...prev,
                              [it.id]: {
                                ...(prev[it.id] ?? { usePersonal: false, ratePercent: defPct, note: '' }),
                                ratePercent: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <input
                          className={styles.input}
                          placeholder="備註"
                          disabled={!ed?.usePersonal}
                          value={ed?.note ?? ''}
                          onChange={(e) =>
                            setModalEdits((prev) => ({
                              ...prev,
                              [it.id]: {
                                ...(prev[it.id] ?? { usePersonal: false, ratePercent: defPct, note: '' }),
                                note: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </>
            )}
            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={() => setModalOpen(false)} disabled={modalSaving}>
                關閉
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void saveModal()} disabled={modalSaving || modalLoading}>
                {modalSaving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
