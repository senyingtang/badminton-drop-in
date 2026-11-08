import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = { user_ids?: string[] }

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role, is_active').eq('id', user.id).maybeSingle()
  // 停權中的管理員不可再停權 / 復權他人（與 01d / 01e 一致）
  if (me?.primary_role !== 'platform_admin' || me?.is_active === false) return json(403, { ok: false, error: 'FORBIDDEN' })

  const body = (await req.json().catch(() => ({}))) as Body
  const ids = Array.isArray(body.user_ids) ? body.user_ids.filter(Boolean) : []
  if (ids.length === 0) return json(400, { ok: false, error: 'MISSING_USER_IDS' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const ok: string[] = []
  const failed: Array<{ user_id: string; reason: string }> = []

  for (const uid of ids) {
    try {
      // 已刪除（匿名化）的帳號不可復權：它的 Auth ban 是刪除流程設定的，必須保留
      const { data: target } = await admin.from('app_user_profiles').select('*').eq('id', uid).maybeSingle()
      if (!target) throw new Error('USER_NOT_FOUND')
      if ((target as { is_deleted?: boolean }).is_deleted === true) throw new Error('ACCOUNT_DELETED')
      const { error } = await admin.from('app_user_profiles').update({ is_active: true }).eq('id', uid)
      if (error) throw error
      const { error: unbanError } = await admin.auth.admin.updateUserById(uid, { ban_duration: 'none' })
      if (unbanError) throw unbanError
      await admin.from('kb_audit_logs').insert({
        actor_user_id: user.id,
        action_type: 'bulk_restore_user',
        target_entity_type: 'user',
        target_entity_id: uid,
      })
      ok.push(uid)
    } catch (e) {
      failed.push({ user_id: uid, reason: e instanceof Error ? e.message : 'UNKNOWN' })
    }
  }

  return json(200, { ok: true, restored: ok, failed })
}

