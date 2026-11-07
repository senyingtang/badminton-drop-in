import Link from 'next/link'
import { BILLING_ENABLED, BILLING_PAUSED_MESSAGE } from '@/lib/billing/billingGate'

/**
 * /billing、/billing/topup、/billing/upgrade：計費暫停期間一律顯示暫停說明，
 * 不渲染錢包、交易、儲值或方案頁（頁面程式碼保留，恢復時移除此閘門即可）。
 */
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  if (BILLING_ENABLED) return <>{children}</>
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏸️</div>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>帳務功能暫停中</h1>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 20px' }}>
        {BILLING_PAUSED_MESSAGE}
        <br />
        開放報名目前不收費，場次內的繳費狀態仍可由團主手動標記。
      </p>
      <Link href="/dashboard" className="btn btn-primary">
        回到首頁
      </Link>
    </div>
  )
}
