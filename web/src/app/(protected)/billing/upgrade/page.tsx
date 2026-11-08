'use client'

import Link from 'next/link'
import styles from './upgrade.module.css'
import { ONLINE_PAYMENTS_ENABLED } from '@/lib/payments/paymentGate'

/**
 * 方案頁：保留方案資訊與 UI。
 * 訂閱付款（ECPay 定期定額）尚未完成串接與安全驗證前，不提供購買，也不顯示任何「自動扣款已啟用」的狀態。
 * 啟用時須改為導向後端建立的付款訂單（不可在前端直接呼叫 kb_subscription_activate）。
 */
const SUBSCRIPTION_CHECKOUT_AVAILABLE = ONLINE_PAYMENTS_ENABLED

export default function UpgradePage() {
  const plans = [
    {
      id: 'personal_monthly_350',
      name: '個人月費方案',
      price: 350,
      quota: '每月 8 場額度',
      features: ['超額每場 $50', '跨團評價共享', '基礎配對引擎'],
      color: 'blue'
    },
    {
      id: 'org_5_hosts_1500',
      name: '滿編組織方案 (5席)',
      price: 1500,
      quota: '每人每月 10 場',
      features: ['包含 5 個團主帳號', '獨立組織與共享備註', '進階團隊管理'],
      color: 'purple'
    }
  ]

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/billing" className={styles.backLink}>← 返回帳務</Link>
        <h1 className={styles.title}>方案介紹</h1>
        <p className={styles.sub}>
          {SUBSCRIPTION_CHECKOUT_AVAILABLE
            ? '升級方案解鎖所有配對功能，享受自動化排組的便利。'
            : '線上訂閱付款尚未開放，目前不會自動扣款；方案內容僅供參考。'}
        </p>
      </div>

      <div className={styles.plansGrid}>
        {plans.map((p) => (
          <div key={p.id} className={`${styles.planCard} ${styles[p.color]}`}>
            <h2 className={styles.planName}>{p.name}</h2>
            <div className={styles.priceBox}>
              <span className={styles.currency}>NT$</span>
              <span className={styles.price}>{p.price}</span>
              <span className={styles.cycle}>/ 月</span>
            </div>
            <div className={styles.quota}>{p.quota}</div>
            <ul className={styles.featureList}>
              {p.features.map((f, i) => (
                <li key={i}><span className={styles.check}>✓</span> {f}</li>
              ))}
            </ul>
            <button
              className={`btn btn-primary ${styles.actionBtn}`}
              type="button"
              disabled
              title={SUBSCRIPTION_CHECKOUT_AVAILABLE ? undefined : '線上訂閱付款尚未開放'}
            >
              {SUBSCRIPTION_CHECKOUT_AVAILABLE ? '即將開放' : '尚未開放線上訂閱'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
