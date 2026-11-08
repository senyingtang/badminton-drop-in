import { verifyCheckMacValue } from './checkMacValue'

/**
 * ECPay 商店設定。只從伺服器端祕密（Worker secrets / 環境變數）讀取，不從資料庫明文欄位讀取，
 * 也絕不使用 NEXT_PUBLIC_ 前綴。
 */
export type EcpayConfig = {
  merchantId: string
  hashKey: string
  hashIV: string
  mode: 'sandbox' | 'production'
}

export function getEcpayConfigFromEnv(env: Record<string, string | undefined> = process.env): EcpayConfig | null {
  const merchantId = env.ECPAY_MERCHANT_ID?.trim()
  const hashKey = env.ECPAY_HASH_KEY?.trim()
  const hashIV = env.ECPAY_HASH_IV?.trim()
  const mode = env.ECPAY_MODE?.trim() === 'production' ? 'production' : 'sandbox'
  if (!merchantId || !hashKey || !hashIV) return null
  return { merchantId, hashKey, hashIV, mode }
}

export type VerifiedEcpayNotify = {
  ok: true
  merchantTradeNo: string
  tradeNo: string
  amountCents: number
  rtnCode: string
  simulated: boolean
  payload: Record<string, string>
}

export type RejectedEcpayNotify = {
  ok: false
  reason:
    | 'EMPTY_BODY'
    | 'BAD_CHECK_MAC_VALUE'
    | 'MERCHANT_MISMATCH'
    | 'BAD_MERCHANT_TRADE_NO'
    | 'BAD_TRADE_AMT'
    | 'SIMULATED_PAYMENT_IN_PRODUCTION'
}

/**
 * 驗證 ECPay server notify（ReturnURL / PeriodReturnURL）。任何一項不通過都不得存取資料庫。
 * 驗證順序：CheckMacValue → MerchantID → MerchantTradeNo 格式 → TradeAmt → SimulatePaid。
 */
export async function verifyEcpayNotify(
  payloadText: string,
  config: EcpayConfig,
): Promise<VerifiedEcpayNotify | RejectedEcpayNotify> {
  if (!payloadText) return { ok: false, reason: 'EMPTY_BODY' }
  const payload = Object.fromEntries(new URLSearchParams(payloadText))

  if (!(await verifyCheckMacValue(payload, config.hashKey, config.hashIV))) {
    return { ok: false, reason: 'BAD_CHECK_MAC_VALUE' }
  }
  if (payload.MerchantID !== config.merchantId) return { ok: false, reason: 'MERCHANT_MISMATCH' }

  const merchantTradeNo = String(payload.MerchantTradeNo || '')
  if (!/^[A-Za-z0-9]{1,20}$/.test(merchantTradeNo)) return { ok: false, reason: 'BAD_MERCHANT_TRADE_NO' }

  const tradeAmt = String(payload.TradeAmt || '')
  if (!/^[1-9]\d{0,8}$/.test(tradeAmt)) return { ok: false, reason: 'BAD_TRADE_AMT' }

  // SimulatePaid=1：廠商後台「模擬付款」，不是真實付款。正式環境一律拒絕入帳。
  const simulated = payload.SimulatePaid === '1'
  if (simulated && config.mode === 'production') return { ok: false, reason: 'SIMULATED_PAYMENT_IN_PRODUCTION' }

  return {
    ok: true,
    merchantTradeNo,
    tradeNo: String(payload.TradeNo || ''),
    amountCents: Number(tradeAmt) * 100,
    rtnCode: String(payload.RtnCode || ''),
    simulated,
    payload,
  }
}
