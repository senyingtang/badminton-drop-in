/**
 * 登入 / 註冊共用的驗證與錯誤訊息（純函式，可單元測試）。
 * 原則：錯誤訊息不透露帳號是否存在；不回傳 Supabase 原始英文訊息、不帶 token。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(raw: string): string | null {
  const v = (raw || '').trim()
  if (!v) return '請輸入電子郵件'
  if (v.length > 254 || !EMAIL_RE.test(v)) return '電子郵件格式不正確'
  return null
}

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // bcrypt 上限

export function validatePassword(raw: string): string | null {
  const v = raw || ''
  if (v.length < PASSWORD_MIN) return `密碼至少需要 ${PASSWORD_MIN} 個字元`
  if (v.length > PASSWORD_MAX) return `密碼最多 ${PASSWORD_MAX} 個字元`
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return '密碼需同時包含英文字母與數字'
  return null
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'weak_password'
  | 'same_password'
  | 'link_invalid'
  | 'session_missing'
  | 'signup_disabled'
  | 'auth_unavailable'
  | 'account_suspended'
  | 'account_deleted'
  | 'unknown'

/** 依 Supabase AuthError 的 code / status / message 歸類（不同版本欄位不一致，三者都看）。 */
export function classifyAuthError(err: { code?: string; status?: number; message?: string; name?: string } | null | undefined): AuthErrorCode {
  if (!err) return 'unknown'
  const code = (err.code || '').toLowerCase()
  const msg = (err.message || '').toLowerCase()
  if (isAuthNetworkError(err)) return 'auth_unavailable'
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'invalid_credentials'
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'email_not_confirmed'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429 || msg.includes('rate limit'))
    return 'rate_limited'
  if (code === 'weak_password' || msg.includes('password should')) return 'weak_password'
  if (code === 'same_password' || msg.includes('should be different')) return 'same_password'
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'flow_state_not_found' || code === 'bad_code_verifier' ||
      msg.includes('expired') || msg.includes('invalid') && msg.includes('link')) return 'link_invalid'
  if (code === 'session_not_found' || msg.includes('auth session missing')) return 'session_missing'
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return 'signup_disabled'
  if (code === 'user_banned') return 'account_suspended'
  return 'unknown'
}

export function authErrorMessageZh(code: AuthErrorCode | string): string {
  switch (code) {
    case 'invalid_credentials':
      return '電子郵件或密碼不正確。'
    case 'email_not_confirmed':
      return '此帳號尚未完成信箱驗證，請先點擊驗證信中的連結。'
    case 'rate_limited':
      return '操作太頻繁，請稍候幾分鐘再試。'
    case 'weak_password':
      return `密碼強度不足（至少 ${PASSWORD_MIN} 碼，需含英文字母與數字）。`
    case 'same_password':
      return '新密碼不能與舊密碼相同。'
    case 'link_invalid':
      return '連結已失效或已使用過，請重新申請。'
    case 'session_missing':
      return '登入狀態已失效，請重新登入。'
    case 'signup_disabled':
      return '目前暫停 Email 註冊，請改用 LINE 登入。'
    case 'auth_unavailable':
      return '登入服務暫時無法連線，請稍後再試（目前的登入狀態不會被清除）。'
    case 'account_suspended':
      return '此帳號已停權，如有疑問請聯絡管理員。'
    case 'account_deleted':
      return '此帳號已刪除，無法登入。'
    default:
      return '操作失敗，請稍後再試。'
  }
}

/** 網路 / 逾時 / 5xx：Auth 暫時不可用，不得當成「未登入」而清除 session。 */
export function isAuthNetworkError(err: { name?: string; status?: number; message?: string } | null | undefined): boolean {
  if (!err) return false
  const name = err.name || ''
  if (name === 'AuthRetryableFetchError' || name === 'AbortError' || name === 'TimeoutError') return true
  if (typeof err.status === 'number' && (err.status === 0 || err.status >= 500)) return true
  const msg = (err.message || '').toLowerCase()
  return msg.includes('fetch failed') || msg.includes('network') || msg.includes('timed out') || msg.includes('timeout') || msg.includes('aborted')
}

/** 停權 / 已刪除的 profile 不得取得 session。 */
export function profileLoginBlock(profile: { is_active?: boolean | null; is_deleted?: boolean | null } | null | undefined):
  'account_suspended' | 'account_deleted' | null {
  if (!profile) return null
  if (profile.is_deleted === true) return 'account_deleted'
  if (profile.is_active === false) return 'account_suspended'
  return null
}
