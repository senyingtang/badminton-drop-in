import type { SupabaseClient } from '@supabase/supabase-js'

export type PublicSignupErrorLogInsert = {
  share_signup_code?: string | null
  session_id?: string | null
  user_id?: string | null
  flow?: string | null
  error_code: string
  error_message?: string | null
  error_detail?: Record<string, unknown>
  payload_snapshot?: Record<string, unknown>
  user_agent?: string | null
}

export function isPublicSignupErrorLogsMissing(message: string): boolean {
  const m = (message || '').toLowerCase()
  return m.includes('42p01') || m.includes('does not exist') || m.includes('public_signup_error_logs')
}

export async function insertPublicSignupErrorLog(
  admin: SupabaseClient,
  row: PublicSignupErrorLogInsert,
): Promise<{ ok: true } | { ok: false; message: string; tableMissing?: boolean }> {
  const { error } = await admin.from('public_signup_error_logs').insert({
    share_signup_code: row.share_signup_code ?? null,
    session_id: row.session_id ?? null,
    user_id: row.user_id ?? null,
    flow: row.flow ?? null,
    error_code: row.error_code,
    error_message: row.error_message ?? null,
    error_detail: row.error_detail ?? {},
    payload_snapshot: row.payload_snapshot ?? {},
    user_agent: row.user_agent ?? null,
  })
  if (error) {
    return {
      ok: false,
      message: error.message,
      tableMissing: isPublicSignupErrorLogsMissing(error.message),
    }
  }
  return { ok: true }
}

/** 將 Supabase / PostgREST 錯誤物件可安全記錄的欄位抽出（不含 token） */
export function supabaseErrorDetailFields(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { raw: String(err) }
  const o = err as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['name', 'message', 'code', 'details', 'hint']) {
    if (k in o && o[k] != null) out[k] = o[k]
  }
  return out
}

/** 由 Supabase / RPC 錯誤訊息對應 SIGNUP_* 代碼（供 UI 與 log 一致） */
export function classifyPublicSignupRpcError(err: unknown): { code: string; message: string } {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : ''
  const low = msg.toLowerCase()
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed')) {
    return { code: 'SIGNUP_NETWORK_ERROR', message: msg }
  }
  if (low.includes('is_deleted') && low.includes('true')) return { code: 'SIGNUP_DELETED_ACCOUNT', message: msg }
  if (msg.includes('signup_link_invalid')) return { code: 'SIGNUP_LINK_INVALID', message: msg }
  if (msg.includes('session_signup_not_open')) return { code: 'SIGNUP_SESSION_CLOSED', message: msg }
  if (msg.includes('session_not_found_or_closed')) return { code: 'SIGNUP_SESSION_CLOSED', message: msg }
  if (msg.includes('invalid_display_name')) return { code: 'SIGNUP_INVALID_DISPLAY_NAME', message: msg }
  if (msg.includes('too_many_guests')) return { code: 'SIGNUP_TOO_MANY_GUESTS', message: msg }
  if (msg.includes('invalid_guests')) return { code: 'SIGNUP_INVALID_GUESTS', message: msg }
  if (msg.includes('invalid_guest_display_name')) return { code: 'SIGNUP_INVALID_GUEST_DISPLAY_NAME', message: msg }
  if (msg.includes('invalid_guest_level')) return { code: 'SIGNUP_INVALID_GUEST_LEVEL', message: msg }
  if (msg.includes('duplicate_name')) return { code: 'SIGNUP_DUPLICATE_NAME', message: msg }
  if (msg.includes('duplicate_player_code')) return { code: 'SIGNUP_DUPLICATE_PLAYER_CODE', message: msg }
  if (msg.includes('invalid_player_code')) return { code: 'SIGNUP_INVALID_PLAYER_CODE', message: msg }
  if (msg.includes('already_signed_up')) return { code: 'SIGNUP_ALREADY_REGISTERED', message: msg }
  if (msg.includes('not_allowed_to_resignup')) return { code: 'SIGNUP_NOT_ALLOWED_RESIGNUP', message: msg }
  if (msg.length > 0) return { code: 'SIGNUP_RPC_ERROR', message: msg }
  return { code: 'SIGNUP_UNKNOWN_ERROR', message: 'unknown' }
}

export function narrowSignupRpcCodeByFlow(
  flow: 'self_signup' | 'guest_signup',
  code: string,
): string {
  if (code === 'SIGNUP_RPC_ERROR') {
    return flow === 'guest_signup' ? 'SIGNUP_GUEST_RPC_ERROR' : 'SIGNUP_SELF_RPC_ERROR'
  }
  return code
}

/** 公開報名／LIFF 錯誤 banner 用中文（Part F） */
export function publicSignupFailureBannerZh(code: string): { title: string; body: string } {
  const c = (code || '').trim().toUpperCase()
  return {
    title: '報名失敗',
    body: `請將錯誤代碼提供給團主。\n錯誤代碼：${c}\n建議截圖此畫面以便排查。`,
  }
}

export function lineLoginFailureBannerZh(code: string): { title: string; body: string } {
  const c = (code || '').trim().toUpperCase()
  return {
    title: 'LINE 登入失敗',
    body: `請改用 LINE App 開啟報名連結，或將錯誤代碼提供給團主。\n錯誤代碼：${c}`,
  }
}

/** 將 /login?error= 的 reason 對應機器碼（與 callback 同步） */
export function lineOAuthQueryErrorToCode(raw: string | null | undefined): string {
  const q = (raw || '').trim()
  if (!q) return 'LINE_CALLBACK_UNKNOWN_ERROR'
  if (q === 'line_oauth_state_missing') return 'LINE_OAUTH_STATE_MISSING'
  if (q === 'line_oauth_state_mismatch') return 'LINE_OAUTH_STATE_MISMATCH'
  if (q === 'line_oauth_code_missing') return 'LINE_OAUTH_CODE_MISSING'
  if (q === 'line_invalid_state') return 'LINE_OAUTH_STATE_MISMATCH'
  if (q === 'token_exchange_failed') return 'LINE_OAUTH_TOKEN_EXCHANGE_FAILED'
  if (q === 'missing_sub') return 'LINE_ID_TOKEN_INVALID'
  if (q === 'nonce_mismatch') return 'LINE_ID_TOKEN_INVALID'
  if (q.startsWith('line_oauth_error:')) return 'LINE_OAUTH_USER_DENIED'
  if (q === 'missing_login_channel') return 'LINE_LOGIN_CHANNEL_MISSING'
  if (q === 'service_role_not_configured') return 'LINE_SERVICE_ROLE_MISSING'
  if (q === 'line_generate_link_failed') return 'LINE_GENERATE_LINK_FAILED'
  if (q === 'line_callback_exception') return 'LINE_CALLBACK_UNKNOWN_ERROR'
  if (q === 'missing_auth_user') return 'LINE_CALLBACK_UNKNOWN_ERROR'
  return 'LINE_CALLBACK_UNKNOWN_ERROR'
}

/** 瀏覽器端呼叫 `/api/public/signup-error-log`；失敗只 console.warn，不 throw */
export async function postPublicSignupErrorFromClient(input: {
  share_signup_code?: string | null
  session_id?: string | null
  flow?: string | null
  error_code: string
  error_message?: string | null
  error_detail?: Record<string, unknown>
  payload_snapshot?: Record<string, unknown>
}): Promise<{ ok: boolean }> {
  try {
    const res = await fetch('/api/public/signup-error-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        share_signup_code: input.share_signup_code ?? null,
        session_id: input.session_id ?? null,
        flow: input.flow ?? null,
        error_code: input.error_code,
        error_message: input.error_message ?? null,
        error_detail: input.error_detail ?? {},
        payload_snapshot: input.payload_snapshot ?? {},
      }),
    })
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; errorCode?: string; log?: string }
      | null
    if (!res.ok || j?.ok === false) {
      console.warn('[signup-error-log] API rejected or failed', res.status, j)
      return { ok: false }
    }
    return { ok: true }
  } catch (e) {
    console.warn('[signup-error-log] network or parse failure', e)
    return { ok: false }
  }
}
