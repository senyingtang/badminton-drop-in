/**
 * /auth/callback、/auth/confirm 的結果判斷（純函式，可單元測試）。
 */
import { classifyAuthError } from './authPolicy'

export type CallbackDecision = { redirect: string; message: string }

function isVerifierMissing(err: { code?: string; name?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  const m = (err.message || '').toLowerCase()
  return err.name === 'AuthPKCECodeVerifierMissingError' || err.code === 'bad_code_verifier' || m.includes('code verifier')
}

export function decideAuthCallback(input: {
  type: string
  next: string
  providerError: string | null
  attempted: boolean
  success: boolean
  error: { code?: string; name?: string; message?: string } | null
  hasSession: boolean
}): CallbackDecision {
  const recovery = input.type === 'recovery' || input.next === '/reset-password'
  const loginWith = (q: string) => `/login?${q}${input.next && input.next !== '/dashboard' && !recovery ? `&returnTo=${encodeURIComponent(input.next)}` : ''}`

  if (input.success) {
    return { redirect: input.next, message: recovery ? '驗證成功，請設定新密碼…' : '登入成功，正在跳轉…' }
  }
  if (input.hasSession) {
    // 連結已用過但這個瀏覽器已登入（例如重複點擊）
    return { redirect: input.next, message: '已登入，正在跳轉…' }
  }
  if (input.providerError) {
    return recovery
      ? { redirect: '/forgot-password?error=link_invalid', message: '連結已失效，請重新申請…' }
      : { redirect: loginWith('error=link_invalid'), message: '連結已失效或已使用過…' }
  }
  if (!input.attempted) {
    return { redirect: loginWith('error=auth_callback_failed'), message: '登入資訊不足，請重新登入。' }
  }
  if (isVerifierMissing(input.error)) {
    // PKCE：在「別的瀏覽器 / 裝置」打開驗證信。Supabase 在導回前已完成 email 驗證，只是這裡無法建立 session。
    return recovery
      ? { redirect: '/forgot-password?error=other_device', message: '請在申請重設的同一個瀏覽器開啟連結…' }
      : { redirect: loginWith('reason=email_confirmed'), message: '信箱已驗證，請登入。' }
  }
  const code = classifyAuthError(input.error)
  if (recovery) return { redirect: '/forgot-password?error=link_invalid', message: '連結已失效，請重新申請…' }
  return {
    redirect: loginWith(`error=${code === 'unknown' ? 'auth_callback_failed' : code}`),
    message: '登入失敗，將帶您回登入頁…',
  }
}
