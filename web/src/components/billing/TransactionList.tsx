'use client'

import styles from './TransactionList.module.css'

interface Transaction {
  id: string
  txn_type: string
  amount: number
  balance_before: number
  balance_after: number
  note: string | null
  created_at: string
}

interface TransactionListProps {
  transactions: Transaction[]
  loading?: boolean
}

const txnTypeLabels: Record<string, { label: string; icon: string }> = {
  topup: { label: '儲值', icon: '💰' },
  debit_overage: { label: '超額扣款', icon: '📉' },
  credit_adjustment: { label: '調整入帳', icon: '📈' },
  debit_adjustment: { label: '調整扣款', icon: '📉' },
  refund: { label: '退款', icon: '↩️' },
}

export default function TransactionList({ transactions, loading }: TransactionListProps) {
  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>📋</span>
        <p>尚無交易紀錄</p>
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {transactions.map((tx) => {
        const typeInfo = txnTypeLabels[tx.txn_type] || { label: tx.txn_type, icon: '📄' }
        const isPositive = tx.amount > 0

        return (
          <div key={tx.id} className={styles.item}>
            <div className={styles.itemLeft}>
              <span className={styles.itemIcon}>{typeInfo.icon}</span>
              <div className={styles.itemInfo}>
                <span className={styles.itemType}>{typeInfo.label}</span>
                <span className={styles.itemDate}>
                  {new Date(tx.created_at).toLocaleDateString('zh-TW', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {tx.note && <span className={styles.itemNote}>{tx.note}</span>}
              </div>
            </div>
            <div className={styles.itemRight}>
              <span className={`${styles.itemAmount} ${isPositive ? styles.positive : styles.negative}`}>
                {isPositive ? '+' : ''}{tx.amount.toLocaleString('zh-TW')}
              </span>
              <span className={styles.itemBalance}>
                餘額 {tx.balance_after.toLocaleString('zh-TW')}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
