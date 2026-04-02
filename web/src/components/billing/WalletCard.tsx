'use client'

import Link from 'next/link'
import styles from './WalletCard.module.css'

interface WalletCardProps {
  balance: number
  currency?: string
}

export default function WalletCard({ balance, currency = 'TWD' }: WalletCardProps) {
  const formattedBalance = balance.toLocaleString('zh-TW')

  return (
    <div className={styles.card}>
      <div className={styles.cardInner}>
        <div className={styles.header}>
          <span className={styles.icon}>💳</span>
          <span className={styles.label}>我的錢包</span>
        </div>

        <div className={styles.balanceSection}>
          <span className={styles.currency}>{currency}</span>
          <span className={styles.amount}>{formattedBalance}</span>
        </div>

        <div className={styles.actions}>
          <Link href="/billing/topup" className={styles.topupBtn}>
            + 儲值
          </Link>
        </div>
      </div>

      {/* Decorative elements */}
      <div className={styles.glow} />
      <div className={styles.pattern} />
    </div>
  )
}
