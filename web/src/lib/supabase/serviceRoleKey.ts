/**
 * service_role 金鑰格式檢查（不驗簽，只擋明顯錯誤的值）。
 * 曾發生：secret 被設成整行 `Service_Role_Key=eyJ...`，Supabase 回「Invalid API key」，
 * 前端只看到 500 + 原始訊息。格式不對時改為「未設定」，由各 API 回 SERVICE_ROLE_NOT_CONFIGURED。
 * 不 import supabase-js，方便單元測試（scripts/tests/service-role-key.test.mjs）。
 */

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const SB_SECRET_RE = /^sb_secret_[A-Za-z0-9_-]{16,}$/

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

export type ServiceRoleKeyCheck = { ok: true; kind: 'jwt' | 'sb_secret' } | { ok: false; reason: string }

/** 只回傳原因代碼，不回傳金鑰內容。 */
export function checkServiceRoleKeyFormat(raw: string | undefined | null): ServiceRoleKeyCheck {
  const key = (raw ?? '').trim()
  if (!key) return { ok: false, reason: 'missing' }
  if (SB_SECRET_RE.test(key)) return { ok: true, kind: 'sb_secret' }
  if (!JWT_RE.test(key)) return { ok: false, reason: key.includes('=') ? 'not_a_bare_key (looks like NAME=value)' : 'not_a_jwt_or_sb_secret' }
  const payload = decodeJwtPayload(key)
  if (!payload) return { ok: false, reason: 'jwt_payload_unreadable' }
  if (payload.role !== 'service_role') return { ok: false, reason: `jwt_role_is_${String(payload.role)}` }
  return { ok: true, kind: 'jwt' }
}
