import type { SupabaseClient } from '@supabase/supabase-js'
import { BILLING_ENABLED } from './billingGate'

/** 與 kb_open_registration_with_billing 相同的可開放狀態 */
const OPENABLE_STATUSES = ['draft', 'pending_confirmation'] as const

export type OpenRegistrationResult = {
  ok: true
  via: 'billing_rpc' | 'no_charge_rpc' | 'rls_update' | 'already_open'
}

function isMissingFunctionError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '42883') return true
  return /could not find the function|function .* does not exist/i.test(err.message || '')
}

/**
 * 團主「開放報名」。
 *
 * 計費暫停時：
 * 1. 優先呼叫 kb_open_registration_no_charge（M1.3 migration 提案；權限檢查與原函式相同，但不扣配額 / 錢包）。
 * 2. 若該函式尚未部署到資料庫，改用 RLS 保護的 sessions 更新：
 *    sessions_update_host_owner_admin 只允許 host / 場館管理者 / 平台管理員，
 *    且只從 draft / pending_confirmation 轉為 registration_open（與原函式相同）。
 * 兩條路徑都不寫任何錢包、配額或帳務紀錄。
 */
export async function openRegistration(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<OpenRegistrationResult> {
  if (BILLING_ENABLED) {
    const { data, error } = await supabase.rpc('kb_open_registration_with_billing', { p_session_id: sessionId })
    if (error) throw error
    if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
      throw new Error('開放報名失敗')
    }
    return { ok: true, via: 'billing_rpc' }
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('kb_open_registration_no_charge', {
    p_session_id: sessionId,
  })
  if (!rpcError) {
    if (rpcData && typeof rpcData === 'object' && (rpcData as { ok?: boolean }).ok === false) {
      throw new Error('開放報名失敗')
    }
    return { ok: true, via: 'no_charge_rpc' }
  }
  if (!isMissingFunctionError(rpcError)) throw rpcError

  // Fallback：RLS 保護的直接更新（不扣費）
  const { data: current, error: readErr } = await supabase
    .from('sessions')
    .select('id, status, registration_opened_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (readErr) throw readErr
  if (!current) throw new Error('SESSION_NOT_FOUND')
  if (current.status === 'registration_open') return { ok: true, via: 'already_open' }
  if (!(OPENABLE_STATUSES as readonly string[]).includes(String(current.status))) {
    throw new Error('INVALID_SESSION_STATUS')
  }

  const nowIso = new Date().toISOString()
  const { data: updated, error: updErr } = await supabase
    .from('sessions')
    .update({
      status: 'registration_open',
      allow_self_signup: true,
      registration_opened_at: current.registration_opened_at ?? nowIso,
      updated_at: nowIso,
    })
    .eq('id', sessionId)
    .in('status', [...OPENABLE_STATUSES])
    .select('id')
  if (updErr) throw updErr
  // RLS 拒絕時 PostgREST 回傳 0 列而非錯誤
  if (!updated || updated.length !== 1) throw new Error('NO_PERMISSION')
  return { ok: true, via: 'rls_update' }
}
