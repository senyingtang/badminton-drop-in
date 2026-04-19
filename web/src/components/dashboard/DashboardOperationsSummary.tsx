'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from '@/app/(protected)/dashboard/dashboard.module.css'

interface ReportRow {
  id: string
  title: string | null
  shuttlecock_cost_twd: number
  venue_fee_twd: number
  other_cost_twd: number
  expected_fee_per_person_twd: number
  assumed_collected_headcount: number
  created_at: string
}

function computeTotals(r: Pick<ReportRow, 'shuttlecock_cost_twd' | 'venue_fee_twd' | 'other_cost_twd' | 'expected_fee_per_person_twd' | 'assumed_collected_headcount'>) {
  const totalCost =
    Number(r.shuttlecock_cost_twd || 0) + Number(r.venue_fee_twd || 0) + Number(r.other_cost_twd || 0)
  const head = Math.max(0, Number(r.assumed_collected_headcount || 0))
  const fee = Math.max(0, Number(r.expected_fee_per_person_twd || 0))
  const revenue = fee * head
  const profit = revenue - totalCost
  return { totalCost, revenue, profit }
}

const SPARK_COUNT = 10

export default function DashboardOperationsSummary() {
  const { user, loading: userLoading } = useUser()
  const supabase = createClient()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('host_operation_reports')
      .select(
        'id, title, shuttlecock_cost_twd, venue_fee_twd, other_cost_twd, expected_fee_per_person_twd, assumed_collected_headcount, created_at'
      )
      .eq('host_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        setErr('no_table')
      } else {
        setErr(error.message)
      }
      setRows([])
    } else {
      setRows((data as ReportRow[]) || [])
    }
    setLoading(false)
  }, [user?.id, supabase])

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
            前往填報 →
          </Link>
        </div>
        <p className={styles.opsHint}>
          尚無營運報表資料表或尚未啟用。若需試算成本與損益，請確認已套用資料庫遷移後至「營運報表」填寫。
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

  if (rows.length === 0) {
    return (
      <section className={styles.section}>
        <div className={styles.opsHeaderRow}>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
            營運報表概覽
          </h2>
          <Link href="/dashboard/operations" className={styles.opsDetailLink}>
            前往填報 →
          </Link>
        </div>
        <div className={styles.opsEmptyCard}>
          <span className={styles.opsEmptyIcon}>📒</span>
          <p className={styles.opsEmptyTitle}>尚無填報紀錄</p>
          <p className={styles.opsEmptyDesc}>建立一筆成本與報名費試算後，摘要會顯示在此處。</p>
          <Link href="/dashboard/operations" className="btn btn-primary btn-sm">
            開啟營運報表
          </Link>
        </div>
      </section>
    )
  }

  const profits = rows.map((r) => computeTotals(r).profit)
  const sumProfit = profits.reduce((a, b) => a + b, 0)
  const sumCost = rows.reduce((a, r) => a + computeTotals(r).totalCost, 0)
  const sumRevenue = rows.reduce((a, r) => a + computeTotals(r).revenue, 0)
  const lastProfit = profits[0] ?? 0

  const spark = [...rows].slice(0, SPARK_COUNT).reverse()
  const maxAbs = Math.max(...spark.map((r) => Math.abs(computeTotals(r).profit)), 1)

  return (
    <section className={styles.section}>
      <div className={styles.opsHeaderRow}>
        <div>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-1)' }}>
            營運報表概覽
          </h2>
          <p className={styles.opsSub}>依您填寫的「營運報表」試算彙整（實際以現場收款為準）。</p>
        </div>
        <Link href="/dashboard/operations" className={styles.opsDetailLink}>
          詳細填報與列表 →
        </Link>
      </div>

      <div className={styles.opsKpiGrid}>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>填報筆數</div>
          <div className={styles.opsKpiValue}>{rows.length}</div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>累計預估收入 (NT$)</div>
          <div className={styles.opsKpiValue}>{sumRevenue.toLocaleString('zh-TW')}</div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>累計試算成本 (NT$)</div>
          <div className={styles.opsKpiValue}>{sumCost.toLocaleString('zh-TW')}</div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>累計預估損益 (NT$)</div>
          <div
            className={`${styles.opsKpiValue} ${sumProfit >= 0 ? styles.opsProfitPos : styles.opsProfitNeg}`}
          >
            {sumProfit >= 0 ? '+' : ''}
            {sumProfit.toLocaleString('zh-TW')}
          </div>
        </div>
        <div className={styles.opsKpiCard}>
          <div className={styles.opsKpiLabel}>最新一筆損益 (NT$)</div>
          <div
            className={`${styles.opsKpiValue} ${lastProfit >= 0 ? styles.opsProfitPos : styles.opsProfitNeg}`}
          >
            {lastProfit >= 0 ? '+' : ''}
            {lastProfit.toLocaleString('zh-TW')}
          </div>
          <div className={styles.opsKpiFoot}>{rows[0]?.title || '（無標題）'}</div>
        </div>
      </div>

      <div className={styles.opsChartCard}>
        <div className={styles.opsChartTitle}>最近 {spark.length} 筆 — 預估損益（由舊到新）</div>
        <div className={styles.opsSpark} aria-hidden>
          {spark.map((r) => {
            const p = computeTotals(r).profit
            const h = Math.round((Math.abs(p) / maxAbs) * 100)
            const barH = Math.max(8, h)
            return (
              <div key={r.id} className={styles.opsSparkCol} title={`${new Date(r.created_at).toLocaleDateString('zh-TW')}：${p >= 0 ? '+' : ''}${p}`}>
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
    </section>
  )
}
