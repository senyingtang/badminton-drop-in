import type { SupabaseClient } from '@supabase/supabase-js'

export async function auditSessionParticipantContactMessage(
  admin: SupabaseClient,
  actorUserId: string,
  payload: {
    sessionId: string
    participantId: string
    messageCharCount: number
  },
) {
  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: actorUserId,
    target_user_id: null,
    action: 'session_participant_contact_message',
    entity_type: 'session_participants',
    entity_id: payload.participantId,
    before_data: null,
    after_data: {
      session_id: payload.sessionId,
      participant_id: payload.participantId,
      message_char_count: payload.messageCharCount,
    },
    note: null,
  })
}

export async function auditSessionParticipantBroadcastMessage(
  admin: SupabaseClient,
  actorUserId: string,
  payload: {
    sessionId: string
    participantIds: string[]
    sent: number
    failed: number
    messageCharCount: number
    results: { participantId: string; ok: boolean; errorCode?: string }[]
  },
) {
  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: actorUserId,
    target_user_id: null,
    action: 'session_participant_broadcast_message',
    entity_type: 'sessions',
    entity_id: payload.sessionId,
    before_data: null,
    after_data: {
      session_id: payload.sessionId,
      participant_ids: payload.participantIds,
      sent: payload.sent,
      failed: payload.failed,
      message_char_count: payload.messageCharCount,
      results: payload.results,
    },
    note: null,
  })
}
