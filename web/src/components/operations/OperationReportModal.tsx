'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { computeSessionOperationReportAmounts } from '@/lib/operations/sessionOperationReportMath'
import styles from './OperationReportModal.module.css'

type PrereqJson = {
  ok: boolean
  session?: {
    id: string
    title: string
    fee_cents: number
    max_participants: number | null
  }
  confirmed_main_count?: number
  existing_report?: Record<string, unknown> | null
}

export type OperationReportModalProps = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  mode: 'end_session' | 'edit'
  sessionId: string
  reportId?: string | null
  initialReport?: Record<string, unknown> | null
}

function yuanToCents(y: number): number {
  return Math.max(0, Math.round(Number(y) * 100))
}

function centsToYuan(c: number): number {
  return Math.round(Number(c) / 100)
}

function fmtNtd(cents: number): string {
  return (Number(cents) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
}

export default function OperationReportModal({
  open,
  onClose,
  onSuccess,
  mode,
  sessionId,
  reportId,
  initialReport,
}: OperationReportModalProps) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState('')
  const [hasExisting, setHasExisting] = useState(false)

  const [actualPlayers, setActualPlayers] = useState(0)
  const [actualFeeYuan, setActualFeeYuan] = useState(0)
  const [expectedPlayers, setExpectedPlayers] = useState<number | ''>('')
  const [expectedFeeYuan, setExpectedFeeYuan] = useState<number | ''>('')
  const [shuttleUsed, setShuttleUsed] = useState<number | ''>('')
  const [shuttleUnitYuan, setShuttleUnitYuan] = useState<number | ''>('')
  const [otherIncomeYuan, setOtherIncomeYuan] = useState(0)
  const [otherExpenseYuan, setOtherExpenseYuan] = useState(0)
  const [note, setNote] = useState('')

  const resetFromPrereq = useCallback((p: PrereqJson) => {
    const s = p.session
    setSessionTitle(s?.title || '')
    setHasExisting(Boolean(p.existing_report))
    const feeC = s?.fee_cents ?? 0
    const cnt = p.confirmed_main_count ?? 0
    setActualPlayers(cnt)
    setActualFeeYuan(centsToYuan(feeC))
    setExpectedPlayers(s?.max_participants ?? '')
    setExpectedFeeYuan(centsToYuan(feeC))
    setShuttleUsed('')
    setShuttleUnitYuan('')
    setOtherIncomeYuan(0)
    setOtherExpenseYuan(0)
    setNote('')
    if (p.existing_report) {
      const r = p.existing_report
      setActualPlayers(Number(r.actual_paid_players ?? cnt))
      setActualFeeYuan(centsToYuan(Number(r.actual_fee_cents ?? feeC)))
      setExpectedPlayers(r.expected_paid_players != null ? Number(r.expected_paid_players) : (s?.max_participants ?? ''))
      setExpectedFeeYuan(
        r.expected_fee_cents != null ? centsToYuan(Number(r.expected_fee_cents)) : centsToYuan(feeC),
      )
      setShuttleUsed(r.shuttlecock_used != null ? Number(r.shuttlecock_used) : '')
      setShuttleUnitYuan(
        r.shuttlecock_unit_cost_cents != null ? centsToYuan(Number(r.shuttlecock_unit_cost_cents)) : '',
      )
      setOtherIncomeYuan(centsToYuan(Number(r.other_income_cents ?? 0)))
      setOtherExpenseYuan(centsToYuan(Number(r.other_expense_cents ?? 0)))
      setNote(String(r.note || ''))
    }
  }, [])

  const resetFromReport = useCallback((r: Record<string, unknown>) => {
    setSessionTitle('')
    setHasExisting(true)
    setActualPlayers(Number(r.actual_paid_players ?? 0))
    setActualFeeYuan(centsToYuan(Number(r.actual_fee_cents ?? 0)))
    setExpectedPlayers(r.expected_paid_players != null ? Number(r.expected_paid_players) : '')
    setExpectedFeeYuan(r.expected_fee_cents != null ? centsToYuan(Number(r.expected_fee_cents)) : '')
    setShuttleUsed(r.shuttlecock_used != null ? Number(r.shuttlecock_used) : '')
    setShuttleUnitYuan(
      r.shuttlecock_unit_cost_cents != null ? centsToYuan(Number(r.shuttlecock_unit_cost_cents)) : '',
    )
    setOtherIncomeYuan(centsToYuan(Number(r.other_income_cents ?? 0)))
    setOtherExpenseYuan(centsToYuan(Number(r.other_expense_cents ?? 0)))
    setNote(String(r.note || ''))
  }, [])

  useEffect(() => {
    if (!open) return
    setErr(null)
    if (mode === 'edit' && initialReport) {
      resetFromReport(initialReport)
      setLoading(false)
      return
    }
    if (mode === 'end_session') {
      setLoading(true)
      void fetch(`/api/sessions/${sessionId}/operation-report-prereq`, { credentials: 'include' })
        .then((res) => res.json())
        .then((j: PrereqJson) => {
          if (!j.ok) {
            setErr('無法載入場次資料')
            return
          }
          resetFromPrereq(j)
        })
        .catch(() => setErr('載入失敗'))
        .finally(() => setLoading(false))
    }
  }, [open, mode, sessionId, initialReport, resetFromPrereq, resetFromReport])

  const preview = useMemo(() => {
    const feeC = yuanToCents(actualFeeYuan)
    const shuttleUnitC = shuttleUnitYuan === '' ? null : yuanToCents(Number(shuttleUnitYuan))
    const used = shuttleUsed === '' ? null : Number(shuttleUsed)
    return computeSessionOperationReportAmounts({
      actualPaidPlayers: actualPlayers,
      actualFeeCents: feeC,
      shuttlecockUsed: used,
      shuttlecockUnitCostCents: shuttleUnitC,
      otherIncomeCents: yuanToCents(otherIncomeYuan),
      otherExpenseCents: yuanToCents(otherExpenseYuan),
    })
  }, [actualPlayers, actualFeeYuan, shuttleUsed, shuttleUnitYuan, otherIncomeYuan, otherExpenseYuan])

  const submit = async () => {
    setErr(null)
    setLoading(true)
    try {
      const body = {
        actual_paid_players: actualPlayers,
        actual_fee_cents: yuanToCents(actualFeeYuan),
        expected_paid_players: expectedPlayers === '' ? null : Number(expectedPlayers),
        expected_fee_cents: expectedFeeYuan === '' ? null : yuanToCents(Number(expectedFeeYuan)),
        shuttlecock_used: shuttleUsed === '' ? null : Number(shuttleUsed),
        shuttlecock_unit_cost_cents: shuttleUnitYuan === '' ? null : yuanToCents(Number(shuttleUnitYuan)),
        other_income_cents: yuanToCents(otherIncomeYuan),
        other_expense_cents: yuanToCents(otherExpenseYuan),
        note: note.trim() || null,
      }
      if (mode === 'end_session') {
        const res = await fetch(`/api/sessions/${sessionId}/finish-with-operation-report`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !j.ok) {
          setErr(j.error || '結束場次失敗')
          return
        }
      } else {
        if (!reportId) {
          setErr('缺少報表 ID')
          return
        }
        const res = await fetch(`/api/dashboard/operations/reports/${reportId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !j.ok) {
          setErr(j.error || '更新失敗')
          return
        }
      }
      onSuccess()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="op-report-title">
        <h2 id="op-report-title" className={styles.title}>
          {mode === 'end_session' ? '結束場次並建立營運報表' : '編輯營運報表'}
        </h2>
        <p className={styles.sub}>
          {mode === 'end_session'
            ? '送出後場次狀態將變為「已結束」，並建立或更新此場次之營運報表（金額以新台幣整數計，儲存為分）。'
            : '修改後將更新此筆報表並寫入稽核紀錄。'}
          {sessionTitle ? ` 場次：${sessionTitle}` : ''}
        </p>
        {hasExisting && mode === 'end_session' ? (
          <div className={styles.warn}>此場次已有營運報表，送出後會更新既有報表，不會新增第二筆。</div>
        ) : null}
        {err ? <div className={styles.err}>{err}</div> : null}
        {loading && mode === 'end_session' ? (
          <p className={styles.sub}>載入預設值…</p>
        ) : (
          <>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label htmlFor="ap">實際收費人數</label>
                <input
                  id="ap"
                  className="input"
                  type="number"
                  min={0}
                  value={actualPlayers}
                  onChange={(e) => setActualPlayers(Math.max(0, Math.floor(Number(e.target.value))))}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="af">每人報名費（NT$，整數）</label>
                <input
                  id="af"
                  className="input"
                  type="number"
                  min={0}
                  value={actualFeeYuan}
                  onChange={(e) => setActualFeeYuan(Math.max(0, Math.floor(Number(e.target.value))))}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ep">預計收費人數（選填）</label>
                <input
                  id="ep"
                  className="input"
                  type="number"
                  min={0}
                  value={expectedPlayers}
                  onChange={(e) => {
                    const v = e.target.value
                    setExpectedPlayers(v === '' ? '' : Math.max(0, Math.floor(Number(v))))
                  }}
                />
                <span className={styles.hint}>對照開場時「正選上限」等設定</span>
              </div>
              <div className={styles.field}>
                <label htmlFor="ef">預計每人報名費 NT$（選填）</label>
                <input
                  id="ef"
                  className="input"
                  type="number"
                  min={0}
                  value={expectedFeeYuan}
                  onChange={(e) => {
                    const v = e.target.value
                    setExpectedFeeYuan(v === '' ? '' : Math.max(0, Math.floor(Number(v))))
                  }}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="su">使用球數（選填）</label>
                <input
                  id="su"
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={shuttleUsed}
                  onChange={(e) => {
                    const v = e.target.value
                    setShuttleUsed(v === '' ? '' : Number(v))
                  }}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="sc">每顆球成本（NT$，整數，選填）</label>
                <input
                  id="sc"
                  className="input"
                  type="number"
                  min={0}
                  value={shuttleUnitYuan}
                  onChange={(e) => {
                    const v = e.target.value
                    setShuttleUnitYuan(v === '' ? '' : Math.max(0, Math.floor(Number(v))))
                  }}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="oi">其他收入（NT$）</label>
                <input
                  id="oi"
                  className="input"
                  type="number"
                  min={0}
                  value={otherIncomeYuan}
                  onChange={(e) => setOtherIncomeYuan(Math.max(0, Math.floor(Number(e.target.value))))}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="oe">其他支出（NT$）</label>
                <input
                  id="oe"
                  className="input"
                  type="number"
                  min={0}
                  value={otherExpenseYuan}
                  onChange={(e) => setOtherExpenseYuan(Math.max(0, Math.floor(Number(e.target.value))))}
                />
              </div>
            </div>
            <div className={styles.field} style={{ marginTop: 12 }}>
              <label htmlFor="nt">備註（選填）</label>
              <textarea id="nt" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className={styles.summary}>
              <div>
                <strong>報名收入（估）</strong>：NT$ {fmtNtd(preview.actualRevenueCents)}（{actualPlayers} × {actualFeeYuan}）
              </div>
              <div>
                <strong>總收入（含其他收入）</strong>：NT$ {fmtNtd(preview.grossRevenueCents)}
              </div>
              <div>
                <strong>羽球成本</strong>：NT$ {fmtNtd(preview.shuttlecockCostCents)}
              </div>
              <div>
                <strong>總支出（羽球 + 其他支出）</strong>：NT$ {fmtNtd(preview.totalExpenseCents)}
              </div>
              <div>
                <strong>淨收入</strong>：NT$ {fmtNtd(preview.netRevenueCents)}
              </div>
            </div>

            <div className={styles.actions}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
                取消
              </button>
              <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void submit()}>
                {loading ? '處理中…' : mode === 'end_session' ? '確認結束場次' : '儲存變更'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
