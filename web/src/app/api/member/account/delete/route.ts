import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { DELETED_MEMBER_DISPLAY_LABEL } from '@/lib/deletedMemberDisplay'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

type Body = { confirmationText?: string }

/**
 * 會員自行「刪除帳號」：軟刪除 profile、匿名化顯示名稱、清除 LINE 綁定、停用登入（ban）。
 * 不刪除歷史場次／帳務／分潤／付款／訂閱資料列。
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, code: 'UNAUTHENTICATED', message: '未登入' })

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  if (body?.confirmationText?.trim() !== 'DELETE') {
    return json(400, { ok: false, code: 'CONFIRMATION_REQUIRED', message: '必須輸入 DELETE 才能刪除帳號' })
  }

  const admin = createServiceRoleClient()
  if (!admin) return json(503, { ok: false, code: 'SERVICE_ROLE_NOT_CONFIGURED', message: 'Service role 未設定' })

  const uid = user.id

  const { data: profile, error: profErr } = await admin
    .from('app_user_profiles')
    .select('id, display_name, is_deleted')
    .eq('id', uid)
    .maybeSingle()

  if (profErr) return json(500, { ok: false, code: 'PROFILE_READ_FAILED', message: profErr.message })
  if (!profile) return json(400, { ok: false, code: 'PROFILE_NOT_FOUND', message: '找不到會員資料' })
  if ((profile as { is_deleted?: boolean }).is_deleted) {
    return json(400, { ok: false, code: 'ALREADY_DELETED', message: '此帳號已刪除' })
  }

  const snapName =
    typeof (profile as { display_name?: string }).display_name === 'string'
      ? (profile as { display_name: string }).display_name
      : ''

  const auditSelf = async (action_type: string, new_data: Record<string, unknown>) => {
    await admin.from('kb_audit_logs').insert({
      actor_user_id: uid,
      action_type,
      target_entity_type: 'user',
      target_entity_id: uid,
      reason: 'member_self_service_account_delete',
      old_data: { display_name: snapName },
      new_data,
    })
  }

  await auditSelf('member_account_delete_request', { step: 'request' })

  const nowIso = new Date().toISOString()
  const { error: upProfErr } = await admin
    .from('app_user_profiles')
    .update({
      display_name: DELETED_MEMBER_DISPLAY_LABEL,
      is_deleted: true,
      deleted_at: nowIso,
      account_deleted_at: nowIso,
      anonymized_at: nowIso,
      deleted_display_name_snapshot: snapName,
      is_active: false,
      phone: null,
      avatar_url: null,
    })
    .eq('id', uid)

  if (upProfErr) return json(500, { ok: false, code: 'PROFILE_UPDATE_FAILED', message: upProfErr.message })

  await admin
    .from('players')
    .update({ line_oa_user_id: null, line_user_id: null })
    .eq('auth_user_id', uid)

  const { error: lineProfErr } = await admin.from('app_user_profiles').update({ line_oa_user_id: null }).eq('id', uid)
  if (lineProfErr && !/column|does not exist|42703/i.test(lineProfErr.message)) {
    console.warn('clear profile line_oa_user_id:', lineProfErr.message)
  }

  await auditSelf('member_account_anonymize', {
    is_deleted: true,
    display_name: DELETED_MEMBER_DISPLAY_LABEL,
  })

  const { error: banErr } = await admin.auth.admin.updateUserById(uid, {
    ban_duration: '876000h',
    email: `deleted-${uid}@users.invalid`,
  })

  if (banErr) {
    await auditSelf('member_account_auth_disabled', { ok: false, error: banErr.message })
    return json(500, { ok: false, code: 'AUTH_BAN_FAILED', message: banErr.message })
  }

  await auditSelf('member_account_auth_disabled', { ok: true, method: 'ban' })

  return json(200, { ok: true })
}
