'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './topup.module.css'
import { ONLINE_PAYMENTS_ENABLED } from '@/lib/payments/paymentGate'

export default function TopupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState<number>(500)

  const amounts = [150, 300, 500, 1000, 2000]

  const handleTopup = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/payments/topup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_cents: Math.round(amount * 100), provider: 'manual' }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; manual_instructions?: string } | null
      if (!res.ok || !j?.ok) {
        alert('建立儲值訂單失敗：' + (j?.error || 'unknown'))
        return
      }

      alert(j.manual_instructions || '已建立儲值訂單（pending）。')
      router.push('/billing')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/billing" className={styles.backLink}>← 返回帳務</Link>
        <h1 className={styles.title}>錢包儲值</h1>
        <p className={styles.sub}>為您的羽球排組帳戶加值。目前「開放報名」不收費，錢包餘額會完整保留。</p>
      </div>

      <div className={styles.card}>
        <h2 className={styles.label}>選擇儲值金額 (NT$)</h2>
        
        <div className={styles.grid}>
          {amounts.map(amt => (
            <button
              key={amt}
              className={`${styles.amtBtn} ${amount === amt ? styles.selected : ''}`}
              onClick={() => setAmount(amt)}
            >
              NT$ {amt}
            </button>
          ))}
        </div>

        <div className={styles.customAmount}>
          <label className={styles.label}>或自訂金額</label>
          <input
            type="number"
            min="100"
            max="10000"
            className="input"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>

        <button
          className={`btn btn-primary ${styles.submitBtn}`}
          onClick={handleTopup}
          disabled={!ONLINE_PAYMENTS_ENABLED || loading || amount < 100}
        >
          {!ONLINE_PAYMENTS_ENABLED ? '線上儲值暫停中' : loading ? '處理中...' : `確認儲值 NT$ ${amount}`}
        </button>
        <p className={styles.note}>
          {ONLINE_PAYMENTS_ENABLED
            ? '註：金流尚未串接前，此頁會建立 pending 訂單（manual）。正式上線後將導向第三方付款頁。'
            : '線上金流尚未啟用，暫不提供線上儲值。如需加值，請聯絡平台管理員手動入帳。'}
        </p>
      </div>
    </div>
  )
}
