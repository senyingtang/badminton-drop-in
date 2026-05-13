'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/hooks/useUser'
import styles from '@/app/(protected)/dashboard/dashboard.module.css'

type Stats = {
  session_count: number
  gross_revenue_cents: number
  total_expense_cents: number
  net_revenue_cents: number
}

function ntd(cents: number): string {
  return (Number(cents) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
}

const SPARK_COUNT = 10

export default function DashboardOperationsSummary() {
  const { user, loading: userLoading } = useUser()
  const [stats, setStats] = useState<Stats | null>(null)
  const [sparkNet, setSparkNet] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) {
      setStats(null)
      setSparkNet([])
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    const res = await fetch('/api/dashboard/operations/reports', { credentials: 'include' })
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; stats?: Stats; reports?: { net_revenue_cents: number; created_at: string }[]; error?: string }
      | null
    if (!res.ok || !j?.ok) {
      if (j?.error === 'TABLE_MISSING' || (j as { hint?: string })?.hint) {
        setErr('no_table')
      } else {
        setErr(j?.error || res.statusText)
      }
      setStats(null)
      setSparkNet([])
    } else {
      setStats(j.stats || null)
      const nets = (j.reports || []).slice(0, SPARK_COUNT).map((r) => Number(r.net_revenue_cents || 0))
      setSparkNet([...nets].reverse())
    }
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    if (userLoading) return
    void load()
  }, [userLoading, load])

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

  if (!stats || stats.session_count === 0) {
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
          <p className={styles.opsEmptyTitle}>尚無場次營運報表</p>
          <p className={styles.opsEmptyDesc}>結束場次並填寫報表後，摘要會顯示在此處。</p>
          <Link href="/dashboard/operations" className="btn btn-primary btn-sm">
            開啟營運報表
          </Link>
        </div>
      </section>
    )
  }

  const lastNet = sparkNet.length > 0 ? sparkNet[sparkNet.length - 1] : stats.net_revenue_cents
  const maxAbs = Math.max(...sparkNet.map((n) => Math.abs(n)), Math.abs(lastNet), 1)

  return (
    <section className={styles.section}>
      <div className={styles.opsHeaderRow}>
        <div>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-1)' }}>
            營運報表概覽
          </h2>
          <p className={styles.opsSub}>依場次結束時填寫之報表彙整（未刪除筆數；實際以現場收款為準）。</p>
        </div>
        <Link href="/dashboard/operations" className={styles.opsDetailLink}>
          詳細列表 →
        </Link>
      </div>

      <div className={styles.opsKpiGrid}>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>場次數</div>
          <div className={styles.opsKpiValue}>{stats.session_count}</div>
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
          <div
            className={`${styles.opsKpiValue} ${lastNet >= 0 ? styles.opsProfitPos : styles.opsProfitNeg}`}
          >
            {lastNet >= 0 ? '+' : ''}
            {ntd(lastNet)}
          </div>
        </div>
      </div>

      {sparkNet.length > 0 ? (
        <div className={styles.opsChartCard}>
          <div className={styles.opsChartTitle}>最近 {sparkNet.length} 場 — 淨收入（由舊到新）</div>
          <div className={styles.opsSpark} aria-hidden>
            {sparkNet.map((p, idx) => {
              const h = Math.round((Math.abs(p) / maxAbs) * 100)
              const barH = Math.max(8, h)
              return (
                <div key={idx} className={styles.opsSparkCol} title={`${p >= 0 ? '+' : ''}${ntd(p)}`}>
                  <div
                    className={`${styles.opsSparkBar} ${p >= 0 ? styles.opsSparkPos : styles.opsSparkNeg}`}
                    style={{ height: `${barH}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className={styles.opsSparkLegend}>
            <span>
              <span className={styles.opsLegDot} style={{ background: 'var(--accent-green, #34d399)' }} /> 盈餘
            </span>
            <span>
              <span className={styles.opsLegDot} style={{ background: 'var(--accent-red, #f87171)' }} /> 虧損
            </span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
