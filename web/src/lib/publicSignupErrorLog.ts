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

export async function insertPublicSignupErrorLog(
  admin: SupabaseClient,
  row: PublicSignupErrorLogInsert,
): Promise<{ ok: true } | { ok: false; message: string }> {
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
    return { ok: false, message: error.message }
  }
  return { ok: true }
}

/** 由 Supabase / RPC 錯誤訊息對應 SIGNUP_* 代碼（供 UI 與 log 一致） */
export function classifyPublicSignupRpcError(err: unknown): { code: string; message: string } {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : ''
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
  if (msg.includes('already_signed_up')) return { code: 'SIGNUP_ALREADY_SIGNED_UP', message: msg }
  if (msg.includes('not_allowed_to_resignup')) return { code: 'SIGNUP_NOT_ALLOWED_RESIGNUP', message: msg }
  if (msg.length > 0) return { code: 'SIGNUP_RPC_ERROR', message: msg }
  return { code: 'SIGNUP_UNKNOWN_ERROR', message: 'unknown' }
}

/** 瀏覽器端呼叫 `/api/public/signup-error-log`（需已登入時帶 cookie；user_id 以伺服端 session 為準） */
export async function postPublicSignupErrorFromClient(input: {
  share_signup_code?: string | null
  session_id?: string | null
  flow?: string | null
  error_code: string
  error_message?: string | null
  error_detail?: Record<string, unknown>
  payload_snapshot?: Record<string, unknown>
}): Promise<void> {
  try {
    await fetch('/api/public/signup-error-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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
  } catch {
    // best-effort
  }
}
