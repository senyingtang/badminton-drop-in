'use client'

import { useState } from 'react'
import styles from './member-dashboard.module.css'

type Props = {
  referralCode: string
}

export default function ReferralCodeSection({ referralCode }: Props) {
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleCopy = async () => {
    setErr(null)
    try {
      await navigator.clipboard.writeText(referralCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr('無法複製，請手動選取代碼。')
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>您的推薦代碼</h2>
      <p className={styles.desc}>
        好友註冊時填入此代碼，未來符合分潤條件的消費將會列入您的預估分潤。
      </p>
      <div className={styles.codeBox}>{referralCode}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button type="button" className={styles.btn} onClick={() => void handleCopy()}>
          {copied ? '已複製' : '複製代碼'}
        </button>
      </div>
      {err && <p className={styles.warn}>{err}</p>}
      <p className={styles.desc} style={{ marginTop: 14 }}>
        本月預估分潤：Phase 2 後開放
      </p>
    </div>
  )
}
