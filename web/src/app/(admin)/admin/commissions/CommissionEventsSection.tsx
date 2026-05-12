'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './commissions.module.css'

type CommissionEvent = {
  id: string
  created_at: string
  commission_month: string
  referrer_user_id: string
  referred_user_id: string | null
  commission_item_key: string
  commission_item_display_name: string
  source_type: string
  source_amount_cents: number
  applied_rate: string | number
  commission_amount_cents: number
  event_type: string
  status: string
  note: string | null
  referrer_email_snapshot: string | null
  referred_email_snapshot: string | null
}

type Summary = {
  effective_total_cents?: number
  adjustment_total_cents?: number
  voided_total_cents?: number
  event_count?: number
  effective_count?: number
  voided_count?: number
  adjusted_count?: number
}

type ReferrerRow = {
  user_id: string
  email: string | null
  display_name: string | null
  referral_code: string
}

type ItemRow = { id: string; item_key: string; display_name: string }

function ntd(cents: number): string {
  const n = Number(cents) / 100
  if (Number.isNaN(n)) return 'NT$ —'
  return `NT$ ${n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function pctFromDecimal(r: string | number): string {
  const x = Number(r)
  if (Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

function defaultYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function CommissionEventsSection() {
  const [month, setMonth] = useState(defaultYm)
  const [referrerUserId, setReferrerUserId] = useState('')
  const [referredUserIdFilter, setReferredUserIdFilter] = useState('')
  const [itemKey, setItemKey] = useState('')
  const [status, setStatus] = useState('')
  const [eventType, setEventType] = useState('')
  const [events, setEvents] = useState<CommissionEvent[]>([])
  const [summary, setSummary] = useState<Summary>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [referrers, setReferrers] = useState<ReferrerRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])

  const [manualReferrer, setManualReferrer] = useState('')
  const [manualReferred, setManualReferred] = useState('')
  const [manualItemKey, setManualItemKey] = useState('wallet_topup')
  const [manualAmount, setManualAmount] = useState('1000')
  const [manualAt, setManualAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [manualNote, setManualNote] = useState('')
  const [manualBusy, setManualBusy] = useState(false)

  const [voidId, setVoidId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidBusy, setVoidBusy] = useState(false)

  const [adjReferrer, setAdjReferrer] = useState('')
  const [adjItemKey, setAdjItemKey] = useState('wallet_topup')
  const [adjAmount, setAdjAmount] = useState('50')
  const [adjOrigId, setAdjOrigId] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)

  const loadMeta = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch('/api/admin/commissions/referrers'),
      fetch('/api/admin/commissions/items'),
    ])
    const j1 = (await r1.json().catch(() => null)) as { ok?: boolean; referrers?: ReferrerRow[] } | null
    const j2 = (await r2.json().catch(() => null)) as { ok?: boolean; items?: ItemRow[] } | null
    if (r1.ok && j1?.ok && j1.referrers) setReferrers(j1.referrers)
    if (r2.ok && j2?.ok && j2.items) setItems(j2.items)
  }, [])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const sp = new URLSearchParams()
      sp.set('month', month)
      if (referrerUserId.trim()) sp.set('referrerUserId', referrerUserId.trim())
      if (referredUserIdFilter.trim()) sp.set('referredUserId', referredUserIdFilter.trim())
      if (itemKey.trim()) sp.set('itemKey', itemKey.trim())
      if (status.trim()) sp.set('status', status.trim())
      if (eventType.trim()) sp.set('eventType', eventType.trim())
      sp.set('limit', '80')
      sp.set('offset', '0')
      const res = await fetch(`/api/admin/commissions/events?${sp.toString()}`)
      const j = (await res.json().catch(() => null)) as { ok?: boolean; events?: CommissionEvent[]; summary?: Summary; error?: string } | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setEvents(j.events || [])
      setSummary(j.summary || {})
    } catch (e) {
      setErr(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [month, referrerUserId, referredUserIdFilter, itemKey, status, eventType])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  const submitManual = async () => {
    setManualBusy(true)
    setErr(null)
    setToast(null)
    try {
      const iso = manualAt ? new Date(manualAt).toISOString() : new Date().toISOString()
      const res = await fetch('/api/admin/commissions/events/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrer_user_id: manualReferrer,
          referred_user_id: manualReferred.trim() || null,
          commission_item_key: manualItemKey,
          source_amount: Number(manualAmount),
          source_type: 'manual_test',
          source_occurred_at: iso,
          note: manualNote.trim() || null,
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setToast('已建立手動分潤事件')
      await loadEvents()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '建立失敗')
    } finally {
      setManualBusy(false)
    }
  }

  const submitVoid = async () => {
    if (!voidId) return
    setVoidBusy(true)
    setErr(null)
    setToast(null)
    try {
      const res = await fetch('/api/admin/commissions/events/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: voidId, void_reason: voidReason.trim() }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setToast('已作廢')
      setVoidId(null)
      setVoidReason('')
      await loadEvents()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '作廢失敗')
    } finally {
      setVoidBusy(false)
    }
  }

  const submitAdjust = async () => {
    setAdjBusy(true)
    setErr(null)
    setToast(null)
    try {
      const res = await fetch('/api/admin/commissions/events/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrer_user_id: adjReferrer,
          commission_item_key: adjItemKey,
          adjustment_amount: Number(adjAmount),
          original_event_id: adjOrigId.trim() || null,
          note: adjNote.trim() || null,
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`)
      setToast('已新增調整分潤')
      await loadEvents()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '調整失敗')
    } finally {
      setAdjBusy(false)
    }
  }

  const cards = useMemo(
    () => [
      { label: '有效分潤（earned）', value: ntd(Number(summary.effective_total_cents || 0)) },
      { label: '調整總額', value: ntd(Number(summary.adjustment_total_cents || 0)) },
      { label: '作廢列金額加總', value: ntd(Number(summary.voided_total_cents || 0)) },
      { label: '有效事件列數', value: String(summary.effective_count ?? 0) },
    ],
    [summary]
  )

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>分潤事件帳本</h2>
      <p className={styles.rowMuted} style={{ marginBottom: 12 }}>
        Phase 3：查詢與手動建立測試事件；不接 webhook、不做請款。不可硬刪列。
      </p>

      {toast && <div className={styles.success}>{toast}</div>}

      <div className={styles.summaryGrid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{c.label}</div>
            <div className={styles.summaryValue}>{c.value}</div>
          </div>
        ))}
      </div>
      <p className={styles.rowMuted} style={{ margin: '8px 0 16px' }}>
        篩選條件內：事件數 {summary.event_count ?? 0} · 作廢筆數 {summary.voided_count ?? 0} · 調整筆數 {summary.adjusted_count ?? 0}
      </p>

      <div className={styles.toolbar} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label className={styles.rowMuted}>月份（YYYY-MM）</label>
          <input className={styles.input} value={month} onChange={(e) => setMonth(e.target.value)} style={{ display: 'block', marginTop: 4 }} />
        </div>
        <div>
          <label className={styles.rowMuted}>推薦人 user_id</label>
          <input className={styles.input} value={referrerUserId} onChange={(e) => setReferrerUserId(e.target.value)} style={{ display: 'block', marginTop: 4, minWidth: 220 }} />
        </div>
        <div>
          <label className={styles.rowMuted}>被推薦人 user_id</label>
          <input
            className={styles.input}
            value={referredUserIdFilter}
            onChange={(e) => setReferredUserIdFilter(e.target.value)}
            style={{ display: 'block', marginTop: 4, minWidth: 200 }}
          />
        </div>
        <div>
          <label className={styles.rowMuted}>項目 item_key</label>
          <input className={styles.input} value={itemKey} onChange={(e) => setItemKey(e.target.value)} style={{ display: 'block', marginTop: 4 }} placeholder="wallet_topup" />
        </div>
        <div>
          <label className={styles.rowMuted}>狀態</label>
          <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)} style={{ display: 'block', marginTop: 4 }}>
            <option value="">全部</option>
            <option value="pending">pending</option>
            <option value="effective">effective</option>
            <option value="voided">voided</option>
            <option value="adjusted">adjusted</option>
          </select>
        </div>
        <div>
          <label className={styles.rowMuted}>類型</label>
          <select className={styles.select} value={eventType} onChange={(e) => setEventType(e.target.value)} style={{ display: 'block', marginTop: 4 }}>
            <option value="">全部</option>
            <option value="earned">earned</option>
            <option value="adjustment">adjustment</option>
            <option value="reversal">reversal</option>
          </select>
        </div>
        <button type="button" className={styles.btn} onClick={() => void loadEvents()} disabled={loading}>
          重新整理
        </button>
      </div>

      <h3 className={styles.subSectionTitle}>手動建立測試事件</h3>
      <div className={styles.formGrid}>
        <div>
          <label className={styles.rowMuted}>推薦人</label>
          <select className={styles.select} value={manualReferrer} onChange={(e) => setManualReferrer(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }}>
            <option value="">請選擇</option>
            {referrers.map((r) => (
              <option key={r.user_id} value={r.user_id}>
                {r.display_name || r.email || r.user_id} ({r.referral_code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={styles.rowMuted}>被推薦人（選填，user_id）</label>
          <input className={styles.input} value={manualReferred} onChange={(e) => setManualReferred(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }} />
        </div>
        <div>
          <label className={styles.rowMuted}>分潤項目</label>
          <select className={styles.select} value={manualItemKey} onChange={(e) => setManualItemKey(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }}>
            {items.map((it) => (
              <option key={it.id} value={it.item_key}>
                {it.display_name} ({it.item_key})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={styles.rowMuted}>消費金額（元）</label>
          <input className={styles.input} type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} style={{ display: 'block', marginTop: 4 }} />
        </div>
        <div>
          <label className={styles.rowMuted}>發生時間</label>
          <input className={styles.input} type="datetime-local" value={manualAt} onChange={(e) => setManualAt(e.target.value)} style={{ display: 'block', marginTop: 4 }} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className={styles.rowMuted}>備註</label>
          <input className={styles.input} value={manualNote} onChange={(e) => setManualNote(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }} />
        </div>
      </div>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} style={{ marginTop: 10 }} disabled={manualBusy || !manualReferrer} onClick={() => void submitManual()}>
        {manualBusy ? '建立中…' : '建立手動事件'}
      </button>

      <h3 className={styles.subSectionTitle} style={{ marginTop: 24 }}>
        手動調整分潤（元，可正可負）
      </h3>
      <div className={styles.formGrid}>
        <div>
          <label className={styles.rowMuted}>推薦人</label>
          <select className={styles.select} value={adjReferrer} onChange={(e) => setAdjReferrer(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }}>
            <option value="">請選擇</option>
            {referrers.map((r) => (
              <option key={r.user_id} value={r.user_id}>
                {r.display_name || r.email || r.user_id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={styles.rowMuted}>項目 item_key</label>
          <select className={styles.select} value={adjItemKey} onChange={(e) => setAdjItemKey(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }}>
            {items.map((it) => (
              <option key={it.id} value={it.item_key}>
                {it.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={styles.rowMuted}>調整金額（元）</label>
          <input className={styles.input} type="number" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} style={{ display: 'block', marginTop: 4 }} />
        </div>
        <div>
          <label className={styles.rowMuted}>原事件 ID（選填）</label>
          <input className={styles.input} value={adjOrigId} onChange={(e) => setAdjOrigId(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className={styles.rowMuted}>備註</label>
          <input className={styles.input} value={adjNote} onChange={(e) => setAdjNote(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }} />
        </div>
      </div>
      <button type="button" className={styles.btn} style={{ marginTop: 10 }} disabled={adjBusy || !adjReferrer} onClick={() => void submitAdjust()}>
        {adjBusy ? '送出中…' : '新增調整'}
      </button>

      <h3 className={styles.subSectionTitle} style={{ marginTop: 28 }}>
        事件列表
      </h3>
      {loading ? (
        <p className={styles.rowMuted}>載入中…</p>
      ) : err ? (
        <div className={styles.error}>{err}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>建立時間</th>
                <th>月份</th>
                <th>推薦人</th>
                <th>被推薦</th>
                <th>項目</th>
                <th>來源類型</th>
                <th>消費</th>
                <th>比例</th>
                <th>分潤</th>
                <th>狀態</th>
                <th>類型</th>
                <th>備註</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className={styles.mono}>{new Date(ev.created_at).toLocaleString('zh-TW')}</td>
                  <td>{String(ev.commission_month).slice(0, 7)}</td>
                  <td>{ev.referrer_email_snapshot || ev.referrer_user_id.slice(0, 8)}</td>
                  <td>{ev.referred_email_snapshot || ev.referred_user_id?.slice(0, 8) || '—'}</td>
                  <td>{ev.commission_item_display_name}</td>
                  <td className={styles.mono}>{ev.source_type}</td>
                  <td>{ntd(Number(ev.source_amount_cents))}</td>
                  <td>{pctFromDecimal(ev.applied_rate)}</td>
                  <td>{ntd(Number(ev.commission_amount_cents))}</td>
                  <td>{ev.status}</td>
                  <td>{ev.event_type}</td>
                  <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.note || '—'}</td>
                  <td>
                    {ev.status === 'effective' && ev.event_type === 'earned' ? (
                      <button type="button" className={styles.btn} onClick={() => setVoidId(ev.id)}>
                        作廢
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {voidId && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>作廢分潤事件</h3>
            <p className={styles.rowMuted}>事件 ID：{voidId}</p>
            <label className={styles.rowMuted}>原因（必填）</label>
            <input className={styles.input} style={{ width: '100%', marginTop: 6 }} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={() => setVoidId(null)} disabled={voidBusy}>
                取消
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={voidBusy || !voidReason.trim()} onClick={() => void submitVoid()}>
                {voidBusy ? '處理中…' : '確認作廢'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
