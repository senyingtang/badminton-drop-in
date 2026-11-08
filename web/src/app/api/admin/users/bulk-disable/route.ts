import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = { user_ids?: string[] }

/** 約 100 年；與帳號刪除相同的 ban 長度，復權時以 'none' 解除 */
const SUSPEND_BAN_DURATION = '876000h'

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

  const filtered = ids.filter((id) => id !== user.id)
  const skipped = ids.filter((id) => id === user.id).map((id) => ({ user_id: id, reason: 'CANNOT_DISABLE_SELF' }))

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const ok: string[] = []
  const failed: Array<{ user_id: string; reason: string }> = [...skipped]

  for (const uid of filtered) {
    try {
      // 停權必須擋下登入：先 ban Supabase Auth 帳號（無法登入、無法刷新 session），再標記 profile
      const { error: banError } = await admin.auth.admin.updateUserById(uid, { ban_duration: SUSPEND_BAN_DURATION })
      if (banError) throw banError
      const { error } = await admin.from('app_user_profiles').update({ is_active: false }).eq('id', uid)
      if (error) throw error
      await admin.from('kb_audit_logs').insert({
        actor_user_id: user.id,
        action_type: 'bulk_disable_user',
        target_entity_type: 'user',
        target_entity_id: uid,
      })
      ok.push(uid)
    } catch (e) {
      failed.push({ user_id: uid, reason: e instanceof Error ? e.message : 'UNKNOWN' })
    }
  }

  return json(200, { ok: true, disabled: ok, failed })
}

