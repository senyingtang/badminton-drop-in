import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

type Body = { event_id: string; void_reason: string }

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const body = (await req.json().catch(() => null)) as Partial<Body> | null
  const eventId = body?.event_id?.trim()
  const voidReason = body?.void_reason?.trim()
  if (!eventId || !voidReason) return json(400, { ok: false, error: 'INVALID_PAYLOAD' })

  const { data: before, error: fErr } = await admin.from('commission_events').select('*').eq('id', eventId).maybeSingle()
  if (fErr) return json(500, { ok: false, error: fErr.message })
  if (!before) return json(404, { ok: false, error: 'NOT_FOUND' })
  if (before.status === 'voided') return json(400, { ok: false, error: 'ALREADY_VOIDED' })

  const { data: after, error: uErr } = await admin
    .from('commission_events')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by_user_id: user.id,
      void_reason: voidReason,
      updated_by_user_id: user.id,
    })
    .eq('id', eventId)
    .select('*')
    .maybeSingle()
  if (uErr) return json(500, { ok: false, error: uErr.message })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: before.referrer_user_id as string,
    action: 'commission_event_void',
    entity_type: 'commission_events',
    entity_id: eventId,
    before_data: before,
    after_data: after,
    note: voidReason,
  })

  return json(200, { ok: true, event: after })
}
