/**
 * LINE Login（OAuth 2.1 / OIDC）共用邏輯（純函式，可單元測試；Workers 與 Node 皆可用）。
 * - state / nonce 用 crypto.getRandomValues 產生（原本用 Math.random，可預測）。
 * - 暫存 Cookie：HttpOnly、SameSite=Lax（LINE 回跳是頂層 GET 導覽，Lax 會帶上）、HTTPS 時 Secure、10 分鐘。
 * - id_token：雖然直接從 LINE token endpoint 以 TLS + client secret 取得，仍檢查 iss / aud / exp / nonce。
 * - 身分對應：只用 LINE sub 對應既有帳號，不依 email 自動合併不同身分的帳號。
 */

export const LINE_OAUTH_COOKIE = 'kb_line_oauth'
export const LINE_ISSUER = 'https://access.line.me'
export const LINE_OAUTH_MAX_AGE_SEC = 10 * 60

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function lineOAuthCookieOptions(requestUrl: string) {
  const https = new URL(requestUrl).protocol === 'https:'
  return {
    httpOnly: true,
    secure: https,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: LINE_OAUTH_MAX_AGE_SEC,
  }
}

export type LineOAuthCookie = {
  state?: string
  nonce?: string
  returnTo?: string
  t?: number
  referralCode?: string
}

export function parseLineOAuthCookie(raw: string | undefined | null, nowMs = Date.now()): LineOAuthCookie | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as LineOAuthCookie
    if (!v || typeof v !== 'object' || typeof v.state !== 'string' || typeof v.nonce !== 'string') return null
    if (typeof v.t === 'number' && nowMs - v.t > LINE_OAUTH_MAX_AGE_SEC * 1000) return null
    return v
  } catch {
    return null
  }
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = (jwt || '').split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[1].length % 4)) % 4)
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return null
  }
}

export type IdTokenCheck =
  | { ok: true; sub: string; email: string; name: string }
  | { ok: false; reason: 'missing_sub' | 'bad_issuer' | 'bad_audience' | 'expired' | 'nonce_mismatch' | 'invalid_id_token' }

export function checkLineIdToken(
  payload: Record<string, unknown> | null,
  opts: { clientId: string; nonce: string; nowSec?: number },
): IdTokenCheck {
  if (!payload) return { ok: false, reason: 'invalid_id_token' }
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  if (payload.iss !== LINE_ISSUER) return { ok: false, reason: 'bad_issuer' }
  const aud = payload.aud
  const audOk = Array.isArray(aud) ? aud.includes(opts.clientId) : aud === opts.clientId
  if (!audOk) return { ok: false, reason: 'bad_audience' }
  if (typeof payload.exp !== 'number' || payload.exp + 60 < now) return { ok: false, reason: 'expired' }
  if (typeof payload.nonce !== 'string' || !timingSafeEqualStr(payload.nonce, opts.nonce)) return { ok: false, reason: 'nonce_mismatch' }
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) return { ok: false, reason: 'missing_sub' }
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const name = typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : ''
  return { ok: true, sub, email, name }
}

/** LINE 沒提供 email 時的 Supabase Auth 帳號鍵（沿用既有格式，避免既有 LINE 會員對不上）。 */
export function syntheticLineEmail(sub: string): string {
  return `line+${sub}@example.com`
}

type AuthUserLike = { id: string; app_metadata?: Record<string, unknown> | null; user_metadata?: Record<string, unknown> | null }

/** 既有 Auth 帳號是否就是這個 LINE 身分（只看 line_sub，不看 email）。 */
export function authUserHasLineSub(user: AuthUserLike | null | undefined, sub: string): boolean {
  if (!user || !sub) return false
  const a = user.app_metadata?.line_sub
  const u = user.user_metadata?.line_sub
  return a === sub || u === sub
}

export type LineIdentityDecision =
  | { action: 'use'; authUserId: string; via: 'player_binding' | 'existing_line_account' }
  | { action: 'refuse'; reason: 'line_email_linked_to_other_account' }

/**
 * 依序：
 *   1. players.line_user_id = sub 的綁定。
 *   2. 同 email 的既有 Auth 帳號，且它記錄的 line_sub 就是這個 sub（之前用 LINE 建立的帳號，player 綁定遺失時）。
 *   3. 同 email、但不是這個 LINE 身分的帳號（例如 Email 註冊）→ 拒絕，不自動合併。
 * 都沒有時由呼叫端建立新帳號。
 */
export function decideLineIdentity(input: {
  sub: string
  boundAuthUserId: string | null
  existingUserWithEmail: AuthUserLike | null
}): LineIdentityDecision | { action: 'create' } {
  if (input.boundAuthUserId) return { action: 'use', authUserId: input.boundAuthUserId, via: 'player_binding' }
  if (input.existingUserWithEmail) {
    if (authUserHasLineSub(input.existingUserWithEmail, input.sub)) {
      return { action: 'use', authUserId: input.existingUserWithEmail.id, via: 'existing_line_account' }
    }
    return { action: 'refuse', reason: 'line_email_linked_to_other_account' }
  }
  return { action: 'create' }
}
