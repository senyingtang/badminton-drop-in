/**
 * Email 驗證 / 重設密碼送出時，把「完成後要去的頁面」與流程種類記在本機。
 *
 * 原因：Supabase 官方 Email 範本用 {{ .RedirectTo }} 當「網域 + 路徑」前綴（不帶 query），
 * 所以 redirectTo 只能是 `${origin}/auth/confirm`，returnTo 不能放在網址裡。
 * 同一瀏覽器開信 → 讀得到；其他裝置開信 → 讀不到，改用預設頁（不影響驗證本身）。
 */
import { isSafeInternalReturnPath } from '@/lib/safeInternalReturnPath'

const KEY = 'kb_auth_pending'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export type PendingAuthKind = 'signup' | 'recovery'
export type PendingAuth = { kind: PendingAuthKind; next: string; t: number }

export function authConfirmUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/auth/confirm`
}

export function rememberPendingAuth(kind: PendingAuthKind, next: string): void {
  try {
    const safe = isSafeInternalReturnPath(next) ? next.trim() : kind === 'recovery' ? '/reset-password' : '/dashboard'
    localStorage.setItem(KEY, JSON.stringify({ kind, next: safe, t: Date.now() }))
  } catch {
    /* 無痕模式等：忽略，改用預設頁 */
  }
}

export function parsePendingAuth(raw: string | null, now = Date.now()): PendingAuth | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<PendingAuth>
    if (v.kind !== 'signup' && v.kind !== 'recovery') return null
    if (typeof v.t !== 'number' || now - v.t > MAX_AGE_MS || now < v.t - 60_000) return null
    if (!isSafeInternalReturnPath(v.next)) return null
    return { kind: v.kind, next: (v.next as string).trim(), t: v.t }
  } catch {
    return null
  }
}

/** 讀取並清除（一次性） */
export function takePendingAuth(): PendingAuth | null {
  try {
    const v = parsePendingAuth(localStorage.getItem(KEY))
    localStorage.removeItem(KEY)
    return v
  } catch {
    return null
  }
}

/** 根路徑收到 Supabase 回跳參數（redirectTo 未列白名單 → 回 Site URL）時，轉交 /auth/confirm 處理。 */
export function isAuthReturnAtRoot(pathname: string, params: URLSearchParams): boolean {
  if (pathname !== '/') return false
  return params.has('code') || params.has('token_hash') || params.has('error_code')
}
