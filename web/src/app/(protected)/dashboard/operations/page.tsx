'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/hooks/useUser'
import OperationReportModal from '@/components/operations/OperationReportModal'
import styles from './operations.module.css'

type SessionBrief = { id: string; title: string; start_at: string; status: string } | null
type VenueBrief = { id: string; name: string } | null

export type SessionOperationReportRow = {
  id: string
  session_id: string
  host_user_id: string
  venue_id: string | null
  report_date: string
  expected_paid_players: number | null
  expected_fee_cents: number | null
  actual_paid_players: number
  actual_fee_cents: number
  shuttlecock_used: number | null
  shuttlecock_unit_cost_cents: number | null
  other_income_cents: number
  other_expense_cents: number
  gross_revenue_cents: number
  shuttlecock_cost_cents: number
  net_revenue_cents: number
  note: string | null
  created_at: string
  updated_at: string
  session: SessionBrief
  venue: VenueBrief
}

type Stats = {
  session_count: number
  gross_revenue_cents: number
  total_expense_cents: number
  net_revenue_cents: number
}

function ntd(cents: number): string {
  return (Number(cents) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
}

export default function OperationsReportPage() {
  const { user } = useUser()
  const [list, setList] = useState<SessionOperationReportRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editRow, setEditRow] = useState<SessionOperationReportRow | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErr(null)
    const res = await fetch('/api/dashboard/operations/reports', { credentials: 'include' })
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; reports?: SessionOperationReportRow[]; stats?: Stats; error?: string }
      | null
    if (!res.ok || !j?.ok) {
      if (j?.error === 'TABLE_MISSING') {
        setErr('尚未建立資料表：請在 Supabase 執行 docs/083_session_operations_reports.sql')
      } else {
        setErr(j?.error || res.statusText || '載入失敗')
      }
      setList([])
      setStats(null)
    } else {
      setList(j.reports || [])
      setStats(j.stats || null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const openEdit = (row: SessionOperationReportRow) => {
    setEditRow(row)
    setEditOpen(true)
  }

  const handleDelete = async (row: SessionOperationReportRow) => {
    if (!confirm(`確定要刪除此筆營運報表？\n場次：${row.session?.title || row.session_id}\n（為軟刪除，可留稽核）`)) return
    const res = await fetch(`/api/dashboard/operations/reports/${row.id}`, { method: 'DELETE', credentials: 'include' })
    const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !j?.ok) {
      alert(j?.error || '刪除失敗')
      return
    }
    await load()
  }

  return (
    <div className={styles.page}>
      <div>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">
          ← 返回總覽
        </Link>
        <h1 className={styles.pageTitle}>營運報表</h1>
        <p className={styles.lead}>
          場次於「本輪已結束」後，團主結束場次時填寫之實際營運數據。可在此編輯或軟刪除；已刪除者不列入下方統計。
        </p>
      </div>

      {err && <p className={styles.err}>{err}</p>}

      {stats && !err ? (
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>場次數</div>
            <div className={styles.kpiValue}>{stats.session_count}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>總收入（估）</div>
            <div className={styles.kpiValue}>NT$ {ntd(stats.gross_revenue_cents)}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>總支出（估）</div>
            <div className={styles.kpiValue}>NT$ {ntd(stats.total_expense_cents)}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>淨收入（估）</div>
            <div className={`${styles.kpiValue} ${stats.net_revenue_cents >= 0 ? styles.profitPos : styles.profitNeg}`}>
              NT$ {ntd(stats.net_revenue_cents)}
            </div>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className={styles.sectionTitle}>報表列表</h2>
        {loading ? (
          <p className={styles.hint}>載入中…</p>
        ) : list.length === 0 ? (
          <p className={styles.hint}>
            尚無報表。請至場次詳情於「本輪已結束」後點選「結束場次」建立（需先在 Supabase 執行 docs/083_session_operations_reports.sql）。
          </p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>場次</th>
                    <th>日期</th>
                    <th>場館</th>
                    <th className={styles.num}>人數</th>
                    <th className={styles.num}>每人 NT$</th>
                    <th className={styles.num}>總收入</th>
                    <th className={styles.num}>用球</th>
                    <th className={styles.num}>球成本</th>
                    <th className={styles.num}>其他支出</th>
                    <th className={styles.num}>淨收入</th>
                    <th>建立</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.id}>
                      <td>{row.session?.title || '—'}</td>
                      <td className={styles.monoSm}>{String(row.report_date).slice(0, 10)}</td>
                      <td>{row.venue?.name || '—'}</td>
                      <td className={styles.num}>{row.actual_paid_players}</td>
                      <td className={styles.num}>{ntd(row.actual_fee_cents)}</td>
                      <td className={styles.num}>{ntd(row.gross_revenue_cents)}</td>
                      <td className={styles.num}>{row.shuttlecock_used ?? '—'}</td>
                      <td className={styles.num}>{ntd(row.shuttlecock_cost_cents)}</td>
                      <td className={styles.num}>{ntd(row.other_expense_cents)}</td>
                      <td className={`${styles.num} ${row.net_revenue_cents >= 0 ? styles.profitPos : styles.profitNeg}`}>
                        {ntd(row.net_revenue_cents)}
                      </td>
                      <td className={styles.monoSm}>{new Date(row.created_at).toLocaleString('zh-TW')}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(row)}>
                            編輯
                          </button>
                          <button type="button" className={`btn btn-sm ${styles.dangerBtn}`} onClick={() => void handleDelete(row)}>
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.cardList}>
              {list.map((row) => (
                <div key={row.id} className={styles.mobileCard}>
                  <div className={styles.mobileCardTitle}>{row.session?.title || '—'}</div>
                  <div className={styles.mobileCardMeta}>
                    {String(row.report_date).slice(0, 10)} · {row.venue?.name || '—'}
                  </div>
                  <div className={styles.mobileGrid}>
                    <span>人數</span>
                    <span className={styles.num}>{row.actual_paid_players}</span>
                    <span>每人</span>
                    <span className={styles.num}>NT$ {ntd(row.actual_fee_cents)}</span>
                    <span>總收入</span>
                    <span className={styles.num}>NT$ {ntd(row.gross_revenue_cents)}</span>
                    <span>淨收入</span>
                    <span className={`${styles.num} ${row.net_revenue_cents >= 0 ? styles.profitPos : styles.profitNeg}`}>
                      NT$ {ntd(row.net_revenue_cents)}
                    </span>
                  </div>
                  <div className={styles.mobileActions}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(row)}>
                      編輯
                    </button>
                    <button type="button" className={`btn btn-sm ${styles.dangerBtn}`} onClick={() => void handleDelete(row)}>
                      刪除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {editRow ? (
        <OperationReportModal
          open={editOpen}
          onClose={() => {
            setEditOpen(false)
            setEditRow(null)
          }}
          onSuccess={() => void load()}
          mode="edit"
          sessionId={editRow.session_id}
          reportId={editRow.id}
          initialReport={editRow as unknown as Record<string, unknown>}
        />
      ) : null}
    </div>
  )
}
