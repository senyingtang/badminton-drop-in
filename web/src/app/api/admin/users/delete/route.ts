import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { buildUserHardDeletePreview, DbOpError } from '@/lib/admin/userHardDeletePreview'
import { hardDeleteUserPublicData } from '@/lib/admin/hardDeleteUser'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

type Body = { userId: string; confirmationText: string }

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, code: 'UNAUTHENTICATED', message: '未登入' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, code: 'FORBIDDEN', message: '權限不足' })

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  const userId = body?.userId?.trim()
  const confirmationText = body?.confirmationText?.trim()
  if (!userId) return json(400, { ok: false, code: 'INVALID_PAYLOAD', message: '缺少 userId' })
  if (confirmationText !== 'DELETE') return json(400, { ok: false, code: 'CONFIRMATION_REQUIRED', message: '必須輸入 DELETE 才能刪除' })

  if (userId === user.id) return json(400, { ok: false, code: 'CANNOT_DELETE_SELF', message: '不可刪除自己' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, code: 'SERVICE_ROLE_NOT_CONFIGURED', message: 'Service role 未設定' })

  let preview: Awaited<ReturnType<typeof buildUserHardDeletePreview>>
  try {
    preview = await buildUserHardDeletePreview(admin, userId)
  } catch (e) {
    if (e instanceof DbOpError) {
      return json(400, {
        ok: false,
        code: 'QUERY_ERROR',
        message: `${e.table}：查詢失敗，原因：${e.message}`,
        reasons: [{ key: e.table, label: e.table, message: `${e.table}：查詢失敗，原因：${e.message}` }],
        debug: { table: e.table, operation: e.operation, message: e.message, code: e.code, details: e.details },
      })
    }
    const msg = e instanceof Error ? e.message : 'PREVIEW_FAILED'
    return json(400, { ok: false, code: 'PREVIEW_FAILED', message: msg })
  }

  if (!preview.canHardDelete) {
    const reasons = preview.blockReasons.map((r, i) => ({
      key: `block_${i}`,
      label: 'blocked',
      message: r,
    }))
    return json(400, { ok: false, code: 'HARD_DELETE_BLOCKED', message: '無法永久刪除', reasons })
  }

  const beforePayload = JSON.parse(JSON.stringify(preview)) as Record<string, unknown>

  const { error: auditBeforeErr } = await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: userId,
    action: 'hard_delete_user',
    entity_type: 'auth.users',
    entity_id: userId,
    before_data: beforePayload,
    after_data: null,
    note: 'hard_delete_user:before',
  })
  if (auditBeforeErr) return json(500, { ok: false, code: 'AUDIT_BEFORE_FAILED', message: auditBeforeErr.message })

  try {
    await hardDeleteUserPublicData(admin, userId)
    const { error: authErr } = await admin.auth.admin.deleteUser(userId)
    if (authErr) throw new Error(authErr.message)

    const { error: auditAfterErr } = await admin.from('kb_admin_audit_logs').insert({
      actor_user_id: user.id,
      target_user_id: null,
      action: 'hard_delete_user',
      entity_type: 'auth.users',
      entity_id: userId,
      before_data: null,
      after_data: { ok: true, deletedUserId: userId },
      note: 'hard_delete_user:after',
    })
    if (auditAfterErr) {
      return json(200, { ok: true, warning: `DELETED_BUT_AUDIT_AFTER_FAILED: ${auditAfterErr.message}` })
    }

    return json(200, { ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'DELETE_FAILED'
    await admin.from('kb_admin_audit_logs').insert({
      actor_user_id: user.id,
      target_user_id: null,
      action: 'hard_delete_user',
      entity_type: 'auth.users',
      entity_id: userId,
      before_data: null,
      after_data: { ok: false, deletedUserId: userId, error: msg },
      note: 'hard_delete_user:after_failed',
    })
    return json(500, { ok: false, code: 'DELETE_FAILED', message: msg })
  }
}
