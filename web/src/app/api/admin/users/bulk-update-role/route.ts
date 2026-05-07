import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = {
  user_ids?: string[]
  target_role?: 'player' | 'host' | 'venue_owner' | 'platform_admin'
}

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const body = (await req.json().catch(() => ({}))) as Body
  const ids = Array.isArray(body.user_ids) ? body.user_ids.filter(Boolean) : []
  const targetRole = body.target_role
  if (!targetRole) return json(400, { ok: false, error: 'MISSING_TARGET_ROLE' })
  if (ids.length === 0) return json(400, { ok: false, error: 'MISSING_USER_IDS' })

  // Prevent self-change through bulk to reduce foot-guns.
  const filtered = ids.filter((id) => id !== user.id)
  const skipped = ids.filter((id) => id === user.id).map((id) => ({ user_id: id, reason: 'CANNOT_CHANGE_SELF' }))

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const ok: string[] = []
  const failed: Array<{ user_id: string; reason: string }> = [...skipped]

  for (const uid of filtered) {
    try {
      const { error: upErr } = await admin.from('app_user_profiles').update({ primary_role: targetRole }).eq('id', uid)
      if (upErr) throw upErr

      // Sync role memberships: disable all, enable target role.
      await admin.from('user_role_memberships').update({ is_active: false }).eq('user_id', uid)
      await admin.from('user_role_memberships').upsert(
        { user_id: uid, role: targetRole, is_active: true },
        { onConflict: 'user_id,role' }
      )
      await admin.from('user_role_memberships').update({ is_active: true }).eq('user_id', uid).eq('role', targetRole)

      await admin.from('kb_audit_logs').insert({
        actor_user_id: user.id,
        action_type: 'bulk_update_role',
        target_entity_type: 'user',
        target_entity_id: uid,
        new_data: { primary_role: targetRole },
      })

      ok.push(uid)
    } catch (e) {
      failed.push({ user_id: uid, reason: e instanceof Error ? e.message : 'UNKNOWN' })
    }
  }

  return json(200, { ok: true, updated: ok, failed })
}

