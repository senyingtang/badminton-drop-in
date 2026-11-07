/**
 * 線上金流（ECPay / 藍新）目前「未啟用」。
 *
 * 原因：ECPay notify 未驗證 CheckMacValue，任何人都能偽造付款成功事件，
 * 進而入帳錢包、標記訂閱已付款並觸發分潤。在完成正式串接（含 CheckMacValue
 * 驗證、測試商店驗收）之前，所有線上金流入口一律拒絕，且「不讀寫資料庫」。
 *
 * 不受影響：團主在場次內手動標記已繳費、平台管理員手動調整錢包 / 訂閱 / 分潤、營運報表。
 *
 * 重新啟用必須是程式碼變更（實作並測試 CheckMacValue 後移除此閘門），
 * 刻意不提供環境變數開關，避免部署設定失誤時重新打開漏洞。
 */
export const ONLINE_PAYMENTS_ENABLED = false as const

export const PAYMENTS_DISABLED_CODE = 'PAYMENTS_DISABLED'

/** ECPay server notify 的拒絕回應（非 `1|OK`，不改變任何訂單 / 錢包 / 分潤） */
export function ecpayNotifyDisabledResponse(): Response {
  return new Response(`0|${PAYMENTS_DISABLED_CODE}`, {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** 建立付款訂單類 API 的拒絕回應 */
export function paymentCreateDisabledResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: PAYMENTS_DISABLED_CODE,
      message: '線上金流尚未啟用，請聯絡平台管理員手動入帳。',
    }),
    { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
