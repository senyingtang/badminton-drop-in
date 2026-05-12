import type { SupabaseClient } from '@supabase/supabase-js'

export type ParticipantLineNotifyRow = {
  notification_user_id?: string | null
  registered_by_user_id?: string | null
  is_guest_registration?: boolean | null
  guest_display_name?: string | null
  session_display_name?: string | null
  players?: {
    auth_user_id?: string | null
    display_name?: string | null
    line_oa_user_id?: string | null
    line_user_id?: string | null
  } | null
}

export function pickNotifyRecipientUserId(row: ParticipantLineNotifyRow): string | null {
  const n = row.notification_user_id?.trim()
  if (n) return n
  const r = row.registered_by_user_id?.trim()
  if (r) return r
  const a = row.players?.auth_user_id?.trim()
  return a || null
}

/** 推播文案上「被通知的球友」名稱（代報名優先 guest_display_name） */
export function lineNotifySubjectName(row: ParticipantLineNotifyRow): string {
  const g = typeof row.guest_display_name === 'string' ? row.guest_display_name.trim() : ''
  if (g) return g
  const s = typeof row.session_display_name === 'string' ? row.session_display_name.trim() : ''
  if (s) return s
  const p = typeof row.players?.display_name === 'string' ? row.players.display_name.trim() : ''
  return p || '球友'
}

export async function fetchLinePushToForAppUserId(
  admin: SupabaseClient,
  appUserId: string
): Promise<string> {
  const { data } = await admin
    .from('players')
    .select('line_oa_user_id, line_user_id')
    .eq('auth_user_id', appUserId)
    .maybeSingle()
  if (!data || typeof data !== 'object') return ''
  const p = data as { line_oa_user_id?: string | null; line_user_id?: string | null }
  const oa = typeof p.line_oa_user_id === 'string' ? p.line_oa_user_id.trim() : ''
  const leg = typeof p.line_user_id === 'string' ? p.line_user_id.trim() : ''
  return oa || leg || ''
}
