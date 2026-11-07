import { ecpayNotifyDisabledResponse } from '@/lib/payments/paymentGate'

export const runtime = 'nodejs'

/**
 * ECPay server notify（wallet_topup + subscription）。
 *
 * 目前停用：處理邏輯 `processEcpayPaymentNotify`（src/lib/payments/ecpayPaymentNotify.ts，保留未刪）
 * 未驗證 CheckMacValue，會接受偽造的付款成功事件。停用期間不讀取 body、不存取資料庫，
 * 歷史訂單 / 錢包 / 分潤紀錄完全不變。見 src/lib/payments/paymentGate.ts。
 */
export async function POST() {
  return ecpayNotifyDisabledResponse()
}
