'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from './dashboard.module.css'

export default function AdminDashboardPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [kpis, setKpis] = useState<any>(null)

  useEffect(() => {
    const fetchKpis = async () => {
      const { data, error } = await supabase.rpc('kb_admin_get_kpis')
      if (error) {
        console.error('Failed to fetch KPIs:', error)
      } else {
        setKpis(data)
      }
      setLoading(false)
    }

    fetchKpis()
  }, [supabase])

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>營運總覽</h1>
      <p className={styles.subtitle}>即時監控全平臺資料</p>

      <div className={styles.grid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>累積總場次</div>
          <div className={styles.kpiValue}>{kpis?.total_sessions || 0}</div>
        </div>
        
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>30 天內活躍團主</div>
          <div className={styles.kpiValue}>{kpis?.active_hosts_30d || 0}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>預估累積營收 (NT$)</div>
          <div className={`${styles.kpiValue} ${styles.revenue}`}>
            {kpis?.total_revenue_twd?.toLocaleString() || 0}
          </div>
        </div>
      </div>

      <h2 className={styles.quickSectionTitle}>快速操作</h2>
      <p className={styles.quickSectionSub}>常用管理入口（含 LINE 憑證設定，僅平台管理員可填寫）。</p>
      <div className={styles.quickGrid}>
        <Link href="/admin/line" className={`${styles.quickCard} ${styles.quickCardLine}`}>
          <span className={styles.quickIcon}>💬</span>
          <div>
            <div className={styles.quickLabel}>LINE 整合</div>
            <div className={styles.quickDesc}>Messaging API、LINE Login 通道</div>
          </div>
          <span className={styles.quickArrow}>→</span>
        </Link>
        <Link href="/admin/users" className={styles.quickCard}>
          <span className={styles.quickIcon}>👤</span>
          <div>
            <div className={styles.quickLabel}>使用者管理</div>
            <div className={styles.quickDesc}>帳號與錢包</div>
          </div>
          <span className={styles.quickArrow}>→</span>
        </Link>
        <Link href="/admin/audit" className={styles.quickCard}>
          <span className={styles.quickIcon}>📋</span>
          <div>
            <div className={styles.quickLabel}>操作稽核</div>
            <div className={styles.quickDesc}>稽核紀錄</div>
          </div>
          <span className={styles.quickArrow}>→</span>
        </Link>
        <Link href="/admin/ai" className={styles.quickCard}>
          <span className={styles.quickIcon}>🤖</span>
          <div>
            <div className={styles.quickLabel}>AI 整合</div>
            <div className={styles.quickDesc}>模型與額度</div>
          </div>
          <span className={styles.quickArrow}>→</span>
        </Link>
      </div>
    </div>
  )
}
