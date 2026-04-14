'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import BillingQuotaCard from '@/components/billing/BillingQuotaCard'
import WalletCard from '@/components/billing/WalletCard'
import TransactionList from '@/components/billing/TransactionList'
import styles from './billing.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

function parseDashboardPayload(dbData: unknown): Row | null {
  if (dbData == null) return null
  if (typeof dbData === 'string') {
    try {
      return JSON.parse(dbData) as Row
    } catch {
      return null
    }
  }
  if (Array.isArray(dbData)) {
    return (dbData[0] as Row) ?? null
  }
  return dbData as Row
}

/** 組織帳戶回傳巢狀 subscription，攤平成與個人帳相同欄位供卡片使用 */
function normalizeDashboard(dash: Row | null): Row | null {
  if (!dash || typeof dash !== 'object') return null
  if (dash.billing_account_type === 'organization' && dash.subscription && typeof dash.subscription === 'object') {
    const sub = dash.subscription as Record<string, unknown>
    return {
      ...dash,
      plan_code: (sub.plan_code as string | null) ?? dash.plan_code ?? null,
      subscription_status: (sub.status as string | null) ?? dash.subscription_status ?? null,
      period_end: (sub.period_end as string | null) ?? dash.period_end ?? null,
      period_start: (sub.period_start as string | null) ?? dash.period_start ?? null,
    }
  }
  return dash
}

export default function BillingDashboard() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<Row | null>(null)
  const [transactions, setTransactions] = useState<Row[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [repairing, setRepairing] = useState(false)

  const loadTransactions = useCallback(
    async (billingAccountId: string) => {
      const { data: txns } = await supabase
        .from('kb_wallet_transactions')
        .select('*, kb_wallets!inner(billing_account_id)')
        .eq('kb_wallets.billing_account_id', billingAccountId)
        .order('created_at', { ascending: false })
        .limit(20)
      setTransactions(txns || [])
    },
    [supabase]
  )

  const fetchBilling = useCallback(async () => {
    setLoadError(null)
    const { data: dbData, error: rpcError } = await supabase.rpc('kb_get_quota_dashboard')
    if (rpcError) {
      setLoadError(rpcError.message)
      setDashboard(null)
      setTransactions([])
      return
    }

    let dash = normalizeDashboard(parseDashboardPayload(dbData))

    if ((!dash || !dash.billing_account_id) && !rpcError) {
      const { error: ensureErr } = await supabase.rpc('kb_ensure_my_billing_account')
      if (!ensureErr) {
        const { data: db2, error: e2 } = await supabase.rpc('kb_get_quota_dashboard')
        if (!e2) {
          dash = normalizeDashboard(parseDashboardPayload(db2))
        }
      }
    }

    setDashboard(dash)
    if (dash?.billing_account_id) {
      await loadTransactions(String(dash.billing_account_id))
    } else {
      setTransactions([])
    }
  }, [loadTransactions, supabase])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      await fetchBilling()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchBilling])

  const handleRetryRepair = async () => {
    setRepairing(true)
    setLoadError(null)
    try {
      await supabase.rpc('kb_ensure_my_billing_account')
      await fetchBilling()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '修復失敗')
    } finally {
      setRepairing(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入帳務資料中...</p>
      </div>
    )
  }

  if (!dashboard || !dashboard.billing_account_id) {
    return (
      <div className={styles.empty}>
        <h3>尚未啟用帳務功能</h3>
        <p>
          {loadError
            ? `無法載入帳務：${loadError}`
            : '您的帳號尚無法顯示計費總覽（可能尚未建立個人計費帳戶，或資料庫函式需更新）。'}
        </p>
        <p className={styles.emptyHint}>
          請在 Supabase 執行 <code>docs/033_kb_get_quota_dashboard_fallback.sql</code> 後重新整理；若仍失敗，請確認已套用{' '}
          <code>docs/026_kb_resolve_billing_account_autocreate.sql</code> 與種子方案（<code>003_seed_plans_and_defaults.sql</code>）。
        </p>
        <div className={styles.emptyActions}>
          <button type="button" className="btn btn-primary" disabled={repairing} onClick={() => void handleRetryRepair()}>
            {repairing ? '處理中…' : '嘗試建立我的計費帳戶'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
            重新整理
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>帳務總覽</h1>
        <Link href="/billing/upgrade" className={`btn btn-primary ${styles.upgradeBtn}`}>
          ⭐ 升級方案
        </Link>
      </div>

      <div className={styles.grid}>
        {/* Left Column */}
        <div className={styles.metrics}>
          <div className={styles.cardBox}>
            <BillingQuotaCard
              quotaUsed={dashboard.quota_used || 0}
              quotaLimit={dashboard.quota_limit || 0}
              planCode={dashboard.plan_code || null}
              periodEnd={dashboard.period_end || null}
              subscriptionStatus={dashboard.subscription_status || null}
            />
          </div>
          <div className={styles.cardBox}>
            <WalletCard balance={dashboard.wallet_balance || 0} />
          </div>
        </div>

        {/* Right Column */}
        <div className={styles.txnsContainer}>
          <div className={styles.txnsCard}>
            <h3 className={styles.cardTitle}>近期交易紀錄</h3>
            <div className={styles.txnsList}>
              <TransactionList transactions={transactions} />
            </div>
            {transactions.length > 0 && (
              <div className={styles.txnsFooter}>
                <span>僅顯示最近 20 筆紀錄</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
