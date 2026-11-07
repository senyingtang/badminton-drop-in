import { ecpayNotifyDisabledResponse } from '@/lib/payments/paymentGate'

export const runtime = 'nodejs'

/**
 * ECPay 訂閱（定期定額）notify，原本與 /api/payments/ecpay/notify 共用 processEcpayPaymentNotify。
 * 目前停用（未驗證 CheckMacValue），不讀取 body、不存取資料庫。見 src/lib/payments/paymentGate.ts。
 */
export async function POST() {
  return ecpayNotifyDisabledResponse()
}
