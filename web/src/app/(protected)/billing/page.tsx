'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import BillingQuotaCard from '@/components/billing/BillingQuotaCard'
import WalletCard from '@/components/billing/WalletCard'
import TransactionList from '@/components/billing/TransactionList'
import styles from './billing.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export default function BillingDashboard() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<Row | null>(null)
  const [transactions, setTransactions] = useState<Row[]>([])

  useEffect(() => {
    const fetchBilling = async () => {
      // Get dashboard data
      const { data: dbData } = await supabase.rpc('kb_get_quota_dashboard')
      const dash = Array.isArray(dbData) ? dbData[0] : dbData
      setDashboard(dash)

      if (dash?.billing_account_id) {
        // Get wallet transactions
        const { data: txns } = await supabase
          .from('kb_wallet_transactions')
          .select('*, kb_wallets!inner(billing_account_id)')
          .eq('kb_wallets.billing_account_id', dash.billing_account_id)
          .order('created_at', { ascending: false })
          .limit(20)

        setTransactions(txns || [])
      }

      setLoading(false)
    }
    fetchBilling()
  }, [supabase])

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入帳務資料中...</p>
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className={styles.empty}>
        <h3>尚未啟用帳務功能</h3>
        <p>您的帳號發生異常，無法找到對應的計費帳戶。</p>
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
