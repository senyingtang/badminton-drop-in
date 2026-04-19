'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './operations.module.css'

interface ReportRow {
  id: string
  title: string | null
  shuttlecock_label: string | null
  shuttlecock_units: number
  shuttlecock_cost_twd: number
  venue_fee_twd: number
  other_cost_twd: number
  other_cost_note: string | null
  expected_fee_per_person_twd: number
  assumed_collected_headcount: number
  notes: string | null
  created_at: string
}

function computeTotals(r: ReportRow | Omit<ReportRow, 'id' | 'created_at'>) {
  const totalCost =
    Number(r.shuttlecock_cost_twd || 0) + Number(r.venue_fee_twd || 0) + Number(r.other_cost_twd || 0)
  const head = Math.max(0, Number(r.assumed_collected_headcount || 0))
  const fee = Math.max(0, Number(r.expected_fee_per_person_twd || 0))
  const revenue = fee * head
  const profit = revenue - totalCost
  const avgCost = head > 0 ? totalCost / head : null
  return { totalCost, revenue, profit, avgCost }
}

export default function OperationsReportPage() {
  const { user } = useUser()
  const supabase = createClient()
  const [list, setList] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [shuttleLabel, setShuttleLabel] = useState('')
  const [shuttleUnits, setShuttleUnits] = useState(0)
  const [shuttleCost, setShuttleCost] = useState(0)
  const [venueFee, setVenueFee] = useState(0)
  const [otherCost, setOtherCost] = useState(0)
  const [otherNote, setOtherNote] = useState('')
  const [feePerPerson, setFeePerPerson] = useState(0)
  const [headcount, setHeadcount] = useState(0)
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('host_operation_reports')
      .select('*')
      .eq('host_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        setErr('資料表尚未建立：請在 Supabase 執行 docs/038_host_operation_reports_session_lock_public_roster.sql')
      } else {
        setErr(error.message)
      }
      setList([])
    } else {
      setList((data as ReportRow[]) || [])
    }
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    void load()
  }, [load])

  const preview = computeTotals({
    id: '',
    created_at: '',
    title: null,
    shuttlecock_label: shuttleLabel,
    shuttlecock_units: shuttleUnits,
    shuttlecock_cost_twd: shuttleCost,
    venue_fee_twd: venueFee,
    other_cost_twd: otherCost,
    other_cost_note: otherNote || null,
    expected_fee_per_person_twd: feePerPerson,
    assumed_collected_headcount: headcount,
    notes: notes || null,
  })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    setErr(null)
    const { error } = await supabase.from('host_operation_reports').insert({
      host_user_id: user.id,
      title: title.trim() || null,
      shuttlecock_label: shuttleLabel.trim() || null,
      shuttlecock_units: Math.max(0, shuttleUnits),
      shuttlecock_cost_twd: Math.max(0, shuttleCost),
      venue_fee_twd: Math.max(0, venueFee),
      other_cost_twd: Math.max(0, otherCost),
      other_cost_note: otherNote.trim() || null,
      expected_fee_per_person_twd: Math.max(0, feePerPerson),
      assumed_collected_headcount: Math.max(0, headcount),
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) {
      setErr(error.message)
      return
    }
    setTitle('')
    setShuttleLabel('')
    setShuttleUnits(0)
    setShuttleCost(0)
    setVenueFee(0)
    setOtherCost(0)
    setOtherNote('')
    setFeePerPerson(0)
    setHeadcount(0)
    setNotes('')
    await load()
  }

  return (
    <div className={styles.page}>
      <div>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">
          ← 返回總覽
        </Link>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, marginTop: 'var(--space-3)' }}>
          營運報表（成本試算）
        </h1>
        <p className={styles.lead}>
          由團主自行填寫用球、場租與其他支出，並假設每人報名費與預計收費人數；系統計算<strong>總成本</strong>、
          <strong>人均成本</strong>與相對於報名費的<strong>預估營收／損益</strong>（實際以現場與收款為準）。
        </p>
      </div>

      {err && <p className={styles.err}>{err}</p>}

      <form className={styles.formCard} onSubmit={(e) => void handleSave(e)}>
        <h2 className={styles.listTitle} style={{ fontSize: 'var(--text-lg)' }}>
          新增一筆填報
        </h2>
        <div className={styles.field}>
          <label htmlFor="title">標題（選填）</label>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：3/15 晚場試算" />
        </div>
        <div className={styles.field}>
          <label htmlFor="shuttleLabel">球種／用球說明</label>
          <input
            id="shuttleLabel"
            className="input"
            value={shuttleLabel}
            onChange={(e) => setShuttleLabel(e.target.value)}
            placeholder="例：比賽級羽球 AS-50"
          />
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <label htmlFor="shuttleUnits">顆數（整數）</label>
            <input
              id="shuttleUnits"
              type="number"
              min={0}
              className="input"
              value={shuttleUnits}
              onChange={(e) => setShuttleUnits(Number(e.target.value))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="shuttleCost">用球總價 (NT$)</label>
            <input
              id="shuttleCost"
              type="number"
              min={0}
              className="input"
              value={shuttleCost}
              onChange={(e) => setShuttleCost(Number(e.target.value))}
            />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="venueFee">場地費 (NT$)</label>
          <input id="venueFee" type="number" min={0} className="input" value={venueFee} onChange={(e) => setVenueFee(Number(e.target.value))} />
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <label htmlFor="otherCost">其他支出 (NT$)</label>
            <input id="otherCost" type="number" min={0} className="input" value={otherCost} onChange={(e) => setOtherCost(Number(e.target.value))} />
          </div>
          <div className={styles.field}>
            <label htmlFor="otherNote">其他說明</label>
            <input id="otherNote" className="input" value={otherNote} onChange={(e) => setOtherNote(e.target.value)} placeholder="選填" />
          </div>
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <label htmlFor="feePerPerson">假設每人報名費 (NT$)</label>
            <input
              id="feePerPerson"
              type="number"
              min={0}
              className="input"
              value={feePerPerson}
              onChange={(e) => setFeePerPerson(Number(e.target.value))}
            />
            <span className={styles.hint}>可對照場次設定的報名費</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="headcount">預計收費人數（正選＋候補預估）</label>
            <input
              id="headcount"
              type="number"
              min={0}
              className="input"
              value={headcount}
              onChange={(e) => setHeadcount(Number(e.target.value))}
            />
            <span className={styles.hint}>用於人均成本與營收試算</span>
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="notes">備註</label>
          <textarea id="notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className={styles.summary}>
          <div>
            <strong>總成本</strong>：NT$ {preview.totalCost.toLocaleString('zh-TW')}
          </div>
          <div>
            <strong>人均成本</strong>：
            {preview.avgCost != null ? `NT$ ${Math.round(preview.avgCost).toLocaleString('zh-TW')}` : '—（人數為 0）'}
          </div>
          <div>
            <strong>預估報名費收入</strong>：NT$ {preview.revenue.toLocaleString('zh-TW')}（{feePerPerson} × {headcount} 人）
          </div>
          <div>
            <strong>預估損益</strong>：
            <span className={preview.profit >= 0 ? styles.profitPos : styles.profitNeg}>
              {preview.profit >= 0 ? '+' : ''}
              NT$ {preview.profit.toLocaleString('zh-TW')}
            </span>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? '儲存中…' : '儲存此筆填報'}
        </button>
      </form>

      <section>
        <h2 className={styles.listTitle} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>
          歷史填報
        </h2>
        {loading ? (
          <p className={styles.hint}>載入中…</p>
        ) : list.length === 0 ? (
          <p className={styles.hint}>尚無紀錄</p>
        ) : (
          <div className={styles.list}>
            {list.map((row) => {
              const t = computeTotals(row)
              return (
                <div key={row.id} className={styles.listItem}>
                  <div>
                    <div className={styles.listTitle}>{row.title || '（無標題）'}</div>
                    <div className={styles.listMeta}>
                      {new Date(row.created_at).toLocaleString('zh-TW')} · 用球 {row.shuttlecock_label || '—'} · 場租 NT${' '}
                      {row.venue_fee_twd}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 'var(--text-sm)' }}>
                    <div>成本 NT$ {t.totalCost.toLocaleString('zh-TW')}</div>
                    <div className={t.profit >= 0 ? styles.profitPos : styles.profitNeg}>
                  損益 {t.profit >= 0 ? '+' : ''}
                  {t.profit.toLocaleString('zh-TW')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
