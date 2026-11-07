/**
 * 電子錢包 / 儲值 / 開放報名扣款 / 訂閱：目前「暫停」。
 *
 * - 不刪除、不歸零任何錢包或交易紀錄；資料庫 Schema 不變。
 * - 團主開放報名改走不扣費流程（見 openRegistration.ts），權限驗證不變。
 * - 管理員的錢包 / 會員方案調整 API 一併暫停，避免產生新的錢包異動。
 * - 不影響：報名 / 代報名 / 候補、場次內手動已繳費、排組、營運報表、LINE 登入。
 *
 * 線上金流（ECPay）另由 src/lib/payments/paymentGate.ts 停用。
 * 刻意不提供環境變數開關：恢復計費必須是程式碼變更 + 資料庫權限檢討。
 */
export const BILLING_ENABLED = false as const

export const BILLING_PAUSED_CODE = 'BILLING_PAUSED'

export const BILLING_PAUSED_MESSAGE = '錢包、儲值與訂閱功能目前暫停使用，既有餘額與紀錄均保留。'

export function billingPausedResponse(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: BILLING_PAUSED_CODE, message: BILLING_PAUSED_MESSAGE }),
    { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
