'use client'

import styles from './BillingPreflightDialog.module.css'

interface PreflightData {
  can_start: boolean
  consume_mode: string
  quota_limit: number
  quota_used: number
  quota_remaining: number
  trial_remaining: number
  overage_price: number
  wallet_balance: number
  will_block: boolean
  message: string
}

interface BillingPreflightDialogProps {
  isOpen: boolean
  data: PreflightData
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
  onTopUp: () => void
}

export default function BillingPreflightDialog({
  isOpen,
  data,
  loading,
  onConfirm,
  onCancel,
  onTopUp,
}: BillingPreflightDialogProps) {
  if (!isOpen) return null

  const modeLabels: Record<string, string> = {
    trial: '試用額度',
    monthly_quota: '月度配額',
    overage: '超額扣款',
    already_consumed: '已扣費',
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h3 className={styles.title}>
          {data.will_block ? '⛔ 無法開打' : '⚡ 確認開打'}
        </h3>

        <div className={styles.info}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>計費模式</span>
            <span className={styles.rowValue}>{modeLabels[data.consume_mode] || data.consume_mode}</span>
          </div>

          {data.consume_mode !== 'already_consumed' && (
            <>
              <div className={styles.row}>
                <span className={styles.rowLabel}>配額狀態</span>
                <span className={styles.rowValue}>
                  {data.quota_used} / {data.quota_limit}
                  {data.trial_remaining > 0 && ` (試用剩 ${data.trial_remaining})`}
                </span>
              </div>

              {data.consume_mode === 'overage' && (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>超額費用</span>
                  <span className={`${styles.rowValue} ${styles.orange}`}>
                    NT$ {data.overage_price}
                  </span>
                </div>
              )}

              <div className={styles.row}>
                <span className={styles.rowLabel}>錢包餘額</span>
                <span className={`${styles.rowValue} ${data.wallet_balance < data.overage_price && data.consume_mode === 'overage' ? styles.red : ''}`}>
                  NT$ {data.wallet_balance.toLocaleString('zh-TW')}
                </span>
              </div>
            </>
          )}
        </div>

        <p className={styles.message}>{data.message}</p>

        <div className={styles.actions}>
          {data.will_block ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={onTopUp}>
                💰 前往儲值
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? '處理中...' : '✅ 確認開打'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={loading}>
                取消
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
