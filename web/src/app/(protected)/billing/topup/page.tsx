'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from './topup.module.css'

export default function TopupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState<number>(500)

  const amounts = [150, 300, 500, 1000, 2000]

  const handleTopup = async () => {
    setLoading(true)
    try {
      const { error } = await supabase.rpc('kb_user_self_wallet_topup', { p_amount: amount })
      if (error) {
        const msg = error.message || ''
        if (msg.includes('Could not find') || msg.includes('does not exist')) {
          alert('儲值功能需要資料庫函式 kb_user_self_wallet_topup。請在 Supabase 執行 docs/028_kb_wallet_admin_and_self_topup.sql。')
        } else {
          alert('儲值失敗：' + msg)
        }
        return
      }
      alert(`已入帳 NT$ ${amount.toLocaleString('zh-TW')}（模擬儲值，未接金流閘道）。`)
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
        <p className={styles.sub}>為您的羽球排組帳戶加值，以支付超額場次費用。</p>
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
            min="50"
            max="10000"
            className="input"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>

        <button 
          className={`btn btn-primary ${styles.submitBtn}`}
          onClick={handleTopup}
          disabled={loading || amount < 50}
        >
          {loading ? '處理中...' : `確認儲值 NT$ ${amount}`}
        </button>
        <p className={styles.note}>註：儲值金額無法退換現金，限本平台排組服務抵用。</p>
      </div>
    </div>
  )
}
