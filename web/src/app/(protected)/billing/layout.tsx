import { BILLING_NOTICE_MESSAGE, WALLET_READ_ENABLED } from '@/lib/billing/billingGate'

/**
 * /billing、/billing/topup、/billing/upgrade：唯讀帳務。
 * 頁首顯示目前狀態（開放報名免費、線上付款未開放），頁面本身保留錢包 / 交易 / 方案顯示。
 */
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  if (!WALLET_READ_ENABLED) return null
  return (
    <>
      <div
        role="status"
        data-testid="billing-notice"
        style={{
          margin: '0 0 16px',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid var(--border-color, rgba(127,127,127,.3))',
          background: 'var(--bg-secondary, rgba(127,127,127,.08))',
          color: 'var(--text-secondary)',
          fontSize: '.9rem',
          lineHeight: 1.6,
        }}
      >
        ℹ️ {BILLING_NOTICE_MESSAGE}
      </div>
      {children}
    </>
  )
}
