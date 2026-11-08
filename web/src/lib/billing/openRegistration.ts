import type { SupabaseClient } from '@supabase/supabase-js'
import { REGISTRATION_CHARGING_ENABLED } from './billingGate'

export type OpenRegistrationResult = {
  ok: true
  via: 'billing_rpc' | 'no_charge_rpc'
}

/** 資料庫尚未套用 docs/proposals/092_billing_pause_rpc_lockdown/01（沒有 kb_open_registration_no_charge） */
export const NO_CHARGE_RPC_NOT_DEPLOYED = 'NO_CHARGE_RPC_NOT_DEPLOYED'

function isMissingFunctionError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '42883') return true
  return /could not find the function|function .* does not exist/i.test(err.message || '')
}

/**
 * 團主「開放報名」。
 *
 * 計費暫停時只呼叫 kb_open_registration_no_charge：
 * 授權規則與 kb_open_registration_with_billing（052）完全相同（場次 host，或場次帳務組織的 owner / host / manager），
 * 狀態檢查也相同（只能從 draft / pending_confirmation 開放；已開放則回傳 already_open），但不扣配額 / 錢包。
 *
 * 刻意不提供「直接更新 sessions」的 fallback：sessions 的 RLS（host / 場館管理者 / 平台管理員）
 * 與 052 的授權範圍不同，會讓開放報名的權限因取消計費而改變。函式未部署時直接回報錯誤。
 */
export async function openRegistration(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<OpenRegistrationResult> {
  const rpcName = REGISTRATION_CHARGING_ENABLED ? 'kb_open_registration_with_billing' : 'kb_open_registration_no_charge'
  const { data, error } = await supabase.rpc(rpcName, { p_session_id: sessionId })
  if (error) {
    if (!REGISTRATION_CHARGING_ENABLED && isMissingFunctionError(error)) throw new Error(NO_CHARGE_RPC_NOT_DEPLOYED)
    throw error
  }
  if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
    throw new Error('開放報名失敗')
  }
  return { ok: true, via: REGISTRATION_CHARGING_ENABLED ? 'billing_rpc' : 'no_charge_rpc' }
}
