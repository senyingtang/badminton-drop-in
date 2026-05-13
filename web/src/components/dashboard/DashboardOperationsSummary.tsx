'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/hooks/useUser'
import type { OperationsSummaryRange } from '@/lib/operations/buildOperationsSummary'
import styles from '@/app/(protected)/dashboard/dashboard.module.css'

type SummaryStats = {
  report_count: number
  gross_revenue_cents: number
  total_expense_cents: number
  net_revenue_cents: number
  latest_net_revenue_cents: number
}

type ChartPoint = {
  label: string
  date: string
  gross_revenue_cents: number
  total_expense_cents: number
  net_revenue_cents: number
  session_title: string | null
}

const RANGE_OPTIONS: { value: OperationsSummaryRange; label: string }[] = [
  { value: 'per_session', label: '每次' },
  { value: 'monthly', label: '每月' },
  { value: 'quarter', label: '每三個月' },
  { value: 'half_year', label: '每六個月' },
  { value: 'year', label: '每年' },
]

function ntd(cents: number): string {
  return (Number(cents) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
}

export default function DashboardOperationsSummary() {
  const { user, loading: userLoading } = useUser()
  const [range, setRange] = useState<OperationsSummaryRange>('per_session')
  const [stats, setStats] = useState<SummaryStats | null>(null)
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([])
  const [fetchedCount, setFetchedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) {
      setStats(null)
      setChartPoints([])
      setFetchedCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    const res = await fetch(`/api/dashboard/operations/summary?range=${encodeURIComponent(range)}`, {
      credentials: 'include',
    })
    const j = (await res.json().catch(() => null)) as
      | {
          ok?: boolean
          stats?: SummaryStats
          chart_points?: ChartPoint[]
          fetched_report_count?: number
          error?: string
          hint?: string
        }
      | null
    if (!res.ok || !j?.ok) {
      if (j?.error === 'TABLE_MISSING' || j?.hint) {
        setErr('no_table')
      } else {
        setErr(j?.error || res.statusText)
      }
      setStats(null)
      setChartPoints([])
      setFetchedCount(0)
    } else {
      setStats(j.stats || null)
      setChartPoints(j.chart_points || [])
      setFetchedCount(Number(j.fetched_report_count ?? 0))
    }
    setLoading(false)
  }, [user?.id, range])

  useEffect(() => {
    if (userLoading) return
    void load()
  }, [userLoading, load])

  const maxAbsNet = useMemo(() => {
    const vals = chartPoints.map((p) => Math.abs(p.net_revenue_cents))
    const last = stats?.latest_net_revenue_cents ?? 0
    return Math.max(1, ...vals, Math.abs(last))
  }, [chartPoints, stats])

  if (userLoading || loading) {
    return (
      <section className={styles.section}>
        <div className={styles.opsHeaderRow}>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
            營運報表概覽
          </h2>
        </div>
        <p className={styles.opsHint}>載入中…</p>
      </section>
    )
  }

  if (err === 'no_table') {
    return (
      <section className={styles.section}>
        <div className={styles.opsHeaderRow}>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
            營運報表概覽
          </h2>
          <Link href="/dashboard/operations" className={styles.opsDetailLink}>
            前往營運報表 →
          </Link>
        </div>
        <p className={styles.opsHint}>
          尚未建立場次營運報表資料表。請在 Supabase 依序執行 docs/083_session_operations_reports.sql、docs/084_session_operation_reports_venue_cost.sql 後重新整理。
        </p>
      </section>
    )
  }

  if (err) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>營運報表概覽</h2>
        <p className={styles.opsHint} style={{ color: 'var(--danger, #f87171)' }}>
          {err}
        </p>
      </section>
    )
  }

  const noReportsEver = fetchedCount === 0
  const rangeEmpty = !noReportsEver && chartPoints.length === 0

  if (noReportsEver) {
    return (
      <section className={styles.section}>
        <div className={styles.opsHeaderRow}>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
            營運報表概覽
          </h2>
          <Link href="/dashboard/operations" className={styles.opsDetailLink}>
            前往營運報表 →
          </Link>
        </div>
        <div className={styles.opsEmptyCard}>
          <span className={styles.opsEmptyIcon}>📒</span>
          <p className={styles.opsEmptyTitle}>目前尚無營運報表資料</p>
          <p className={styles.opsEmptyDesc}>結束場次並填寫報表後，摘要會顯示在此處。</p>
          <Link href="/dashboard/operations" className="btn btn-primary btn-sm">
            開啟營運報表
          </Link>
        </div>
      </section>
    )
  }

  if (!stats) {
    return null
  }

  const lastNet = stats.latest_net_revenue_cents

  return (
    <section className={styles.section}>
      <div className={styles.opsHeaderRow}>
        <div>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-1)' }}>
            營運報表概覽
          </h2>
          <p className={styles.opsSub}>依場次結束時填寫之報表彙整（未刪除；支出含場地費 + 羽球 + 其他支出）。下方數字與圖表會隨「區間」篩選更新。</p>
        </div>
        <Link href="/dashboard/operations" className={styles.opsDetailLink}>
          詳細列表 →
        </Link>
      </div>

      <div className={styles.opsFilterRow} role="tablist" aria-label="營運報表區間">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={range === opt.value}
            className={`${styles.opsFilterBtn} ${range === opt.value ? styles.opsFilterBtnActive : ''}`}
            onClick={() => setRange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className={styles.opsKpiGrid}>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>場次數</div>
          <div className={styles.opsKpiValue}>{stats.report_count}</div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>累計總收入 (NT$)</div>
          <div className={styles.opsKpiValue}>{ntd(stats.gross_revenue_cents)}</div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>累計支出 (NT$)</div>
          <div className={styles.opsKpiValue}>{ntd(stats.total_expense_cents)}</div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>累計淨收入 (NT$)</div>
          <div
            className={`${styles.opsKpiValue} ${stats.net_revenue_cents >= 0 ? styles.opsProfitPos : styles.opsProfitNeg}`}
          >
            {stats.net_revenue_cents >= 0 ? '+' : ''}
            {ntd(stats.net_revenue_cents)}
          </div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>最新淨收入 (NT$)</div>
          <div className={`${styles.opsKpiValue} ${lastNet >= 0 ? styles.opsProfitPos : styles.opsProfitNeg}`}>
            {lastNet >= 0 ? '+' : ''}
            {ntd(lastNet)}
          </div>
        </div>
      </div>

      {rangeEmpty ? (
        <div className={styles.opsChartCard}>
          <p className={styles.opsHint} style={{ margin: 0 }}>
            此時間範圍內尚無營運報表資料。
          </p>
        </div>
      ) : chartPoints.length > 0 ? (
        <div className={styles.opsChartCard}>
          <div className={styles.opsChartTitleRow}>
            <span className={styles.opsChartTitle}>淨收入趨勢（由舊 → 新，最右為最新）</span>
          </div>
          <div
            className={`${styles.opsBarChart} ${chartPoints.length > 10 ? styles.opsBarChartDense : ''}`}
            role="img"
            aria-label="依區間篩選之淨收入長條圖，由左至右為時間由舊到新"
          >
            {chartPoints.map((p, idx) => {
              const h = Math.round((Math.abs(p.net_revenue_cents) / maxAbsNet) * 100)
              const barH = Math.max(10, h)
              const tip = [
                p.session_title || null,
                `日期 ${p.date}`,
                `總收入 NT$ ${ntd(p.gross_revenue_cents)}`,
                `總支出 NT$ ${ntd(p.total_expense_cents)}`,
                `淨收入 NT$ ${ntd(p.net_revenue_cents)}`,
              ]
                .filter(Boolean)
                .join('\n')
              return (
                <div key={`${p.date}-${idx}`} className={styles.opsBarCol}>
                  <div className={styles.opsBarTrack}>
                    <div
                      className={`${styles.opsSparkBar} ${p.net_revenue_cents >= 0 ? styles.opsSparkPos : styles.opsSparkNeg}`}
                      style={{ height: `${barH}%` }}
                      title={tip}
                    />
                  </div>
                  <div className={styles.opsBarXLabel} title={p.date}>
                    {p.label}
                  </div>
                </div>
              )
            })}
          </div>
          <div className={styles.opsSparkLegend}>
            <span>
              <span className={styles.opsLegDot} style={{ background: 'var(--accent-green, #34d399)' }} /> 淨收入（盈餘）
            </span>
            <span>
              <span className={styles.opsLegDot} style={{ background: 'var(--accent-red, #f87171)' }} /> 淨收入（虧損）
            </span>
            <span className={styles.opsLegendMuted}>長條高度依區間內最大淨收入絕對值比例</span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
