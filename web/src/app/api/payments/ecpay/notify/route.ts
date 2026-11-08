import { handleEcpayNotify } from '@/lib/payments/ecpayNotifyRoute'

export const runtime = 'nodejs'

/**
 * ECPay server notify（wallet_topup + subscription）。
 * 線上金流停用期間（src/lib/payments/paymentGate.ts）一律 503，不讀 body、不存取資料庫。
 * 啟用後的驗證流程見 src/lib/payments/ecpayPaymentNotify.ts。
 */
export async function POST(req: Request) {
  return handleEcpayNotify(req)
}
