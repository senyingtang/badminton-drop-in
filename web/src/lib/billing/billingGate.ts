/**
 * 帳務功能開關（M1.4）。保留錢包 / 交易 / 訂閱 / ECPay 架構，依安全狀態分段開放。
 * 刻意不提供環境變數開關：開啟任何寫入都必須是程式碼變更 + 資料庫權限檢討。
 *
 * - WALLET_READ_ENABLED（開）：帳務總覽、錢包餘額、交易紀錄、方案資訊（唯讀）。
 *   資料庫端以 docs/proposals/092_billing_pause_rpc_lockdown/01b（RLS 讀取範圍）與
 *   01c（配額總覽越權修正）保證每個人只看得到有權限的資料。
 * - BILLING_WRITES_ENABLED（關）：管理員調整錢包 / 配額 / 會員方案。
 *   等 092 的 01、01b、01c 套用到正式資料庫並驗證後才開啟；
 *   寫入只走後端 API（service_role + 平台管理員檢查 + 稽核紀錄）。
 * - REGISTRATION_CHARGING_ENABLED（關）：開放報名不扣費、不追溯補扣（kb_open_registration_no_charge）。
 *   恢復收費時改為 true，並以新 migration 重新授權計費版開放報名函式。
 * - 線上付款（ECPay 儲值 / 訂閱付款）：由 src/lib/payments/paymentGate.ts 控制（關）。
 */
export const WALLET_READ_ENABLED = true as const
export const BILLING_WRITES_ENABLED = false as const
export const REGISTRATION_CHARGING_ENABLED = false as const

export const BILLING_WRITES_PAUSED_CODE = 'BILLING_WRITES_PAUSED'

export const BILLING_WRITES_PAUSED_MESSAGE =
  '錢包調整、配額與會員方案異動將於帳務安全驗證完成後開放；既有餘額與紀錄均保留。'

export const BILLING_NOTICE_MESSAGE =
  '目前開放報名不收費；線上儲值與訂閱付款尚未開放。錢包餘額與交易紀錄均完整保留。'

export function billingWritesPausedResponse(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: BILLING_WRITES_PAUSED_CODE, message: BILLING_WRITES_PAUSED_MESSAGE }),
    { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
