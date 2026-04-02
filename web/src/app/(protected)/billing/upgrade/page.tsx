'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './upgrade.module.css'

export default function UpgradePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

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

  const handleSubscribe = async (planId: string) => {
    setLoading(true)
    // In a real app we'd redirect to ECPay/Stripe or call our RPC properly.
    // For now we mock the click to demonstrate the action.
    alert(`此處應串接金流並調用 kb_subscription_activate，方案：${planId}`)
    setLoading(false)
    router.push('/billing')
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/billing" className={styles.backLink}>← 返回帳務</Link>
        <h1 className={styles.title}>請選擇適合您的方案</h1>
        <p className={styles.sub}>升級方案解鎖所有配對功能，享受自動化排組的便利。</p>
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
              onClick={() => handleSubscribe(p.id)}
              disabled={loading}
            >
              {loading ? '處理中...' : '選擇此方案'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
