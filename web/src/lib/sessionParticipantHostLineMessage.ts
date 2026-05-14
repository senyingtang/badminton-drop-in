import type { ParticipantLineNotifyRow } from '@/lib/lineNotifyRecipient'
import { pickNotifyRecipientUserId, fetchLinePushToForAppUserId } from '@/lib/lineNotifyRecipient'
import type { SupabaseClient } from '@supabase/supabase-js'

export function buildHostContactLineText(
  sessionTitle: string,
  hostMessage: string,
  row: ParticipantLineNotifyRow,
): string {
  const title = sessionTitle.trim() || '羽球場次'
  const body = hostMessage.trim()
  const guest = Boolean(row.is_guest_registration)
  const guestName =
    typeof row.guest_display_name === 'string' && row.guest_display_name.trim()
      ? row.guest_display_name.trim()
      : '球友'
  if (guest) {
    return `【場次通知】${title}\n關於您協助報名的球友「${guestName}」：\n${body}`
  }
  return `【場次通知】${title}\n${body}`
}

/** 依 notification → registered_by → 參與者本人，解析推播用 LINE UID（Messaging `to`） */
export async function resolveSessionParticipantLinePushTo(
  admin: SupabaseClient,
  row: ParticipantLineNotifyRow,
): Promise<string> {
  const uid = pickNotifyRecipientUserId(row)
  if (!uid) return ''
  return fetchLinePushToForAppUserId(admin, uid)
}
