import type { SupabaseClient } from '@supabase/supabase-js'

export type SessionOperationReportAuditAction =
  | 'session_operation_report_create'
  | 'session_operation_report_update'
  | 'session_operation_report_delete'
  | 'session_end_with_operation_report'

export async function auditSessionOperationReport(
  admin: SupabaseClient,
  actorUserId: string | null,
  action: SessionOperationReportAuditAction,
  payload: {
    entityId?: string | null
    before?: unknown
    after?: unknown
    note?: string | null
  },
) {
  const { error } = await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: actorUserId,
    target_user_id: null,
    action,
    entity_type: 'session_operation_reports',
    entity_id: payload.entityId ?? null,
    before_data: payload.before ?? null,
    after_data: payload.after ?? null,
    note: payload.note ?? null,
  })
  if (error) {
    // best-effort
  }
}
