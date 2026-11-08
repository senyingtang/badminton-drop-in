/**
 * ECPay CheckMacValue（SHA256，EncryptType=1）。
 * 規格：https://developers.ecpay.com.tw/?p=2902
 *   1. 排除 CheckMacValue，參數依名稱排序（不分大小寫）後以 & 串接
 *   2. 前加 HashKey=…&，後加 &HashIV=…
 *   3. URL encode（PHP urlencode 等價：空白→+），再套 .NET 對照（- _ . ! * ( ) 不編碼）
 *   4. 轉小寫 → SHA256 → 轉大寫
 * 使用 Web Crypto，Node 與 Cloudflare Workers 皆可執行。
 */

/** 與 ECPay（.NET HttpUtility.UrlEncode）相同的編碼結果 */
export function ecpayUrlEncode(raw: string): string {
  // encodeURIComponent 不編碼：A-Z a-z 0-9 - _ . ! ~ * ' ( )
  // ECPay 對照表：- _ . ! * ( ) 不編碼；~ 與 ' 需要編碼；空白為 +
  return encodeURIComponent(raw).replace(/%20/g, '+').replace(/~/g, '%7E').replace(/'/g, '%27')
}

export function buildCheckMacSource(params: Record<string, string>, hashKey: string, hashIV: string): string {
  const keys = Object.keys(params)
    .filter((k) => k.toLowerCase() !== 'checkmacvalue')
    .sort((a, b) => {
      const la = a.toLowerCase()
      const lb = b.toLowerCase()
      return la < lb ? -1 : la > lb ? 1 : 0
    })
  const body = keys.map((k) => `${k}=${params[k]}`).join('&')
  return `HashKey=${hashKey}&${body}&HashIV=${hashIV}`
}

async function sha256HexUpper(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export async function computeCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): Promise<string> {
  const encoded = ecpayUrlEncode(buildCheckMacSource(params, hashKey, hashIV)).toLowerCase()
  return sha256HexUpper(encoded)
}

/** 固定時間比較，避免以回應時間推測正確的檢查碼 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): Promise<boolean> {
  const received = String(params.CheckMacValue || '').toUpperCase()
  if (!/^[0-9A-F]{64}$/.test(received)) return false
  const expected = await computeCheckMacValue(params, hashKey, hashIV)
  return constantTimeEqual(received, expected)
}
