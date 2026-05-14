import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { ParticipantLineNotifyRow } from '@/lib/lineNotifyRecipient'
import { lineMessagingPushText } from '@/lib/lineMessagingPush'
import { buildHostContactLineText, resolveSessionParticipantLinePushTo } from '@/lib/sessionParticipantHostLineMessage'
import { auditSessionParticipantContactMessage } from '@/lib/sessionParticipantMessagingAudit'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

type Body = { message?: string }

export async function POST(req: Request, ctx: { params: Promise<{ id: string; participantId: string }> }) {
  const { id: sessionId, participantId } = await ctx.params
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json(400, { ok: false, errorCode: 'INVALID_JSON' })
  }

  const rawMsg = typeof body.message === 'string' ? body.message.trim() : ''
  if (!rawMsg) return json(400, { ok: false, errorCode: 'MESSAGE_REQUIRED' })
  if (rawMsg.length > 2000) return json(400, { ok: false, errorCode: 'MESSAGE_TOO_LONG' })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, errorCode: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(503, { ok: false, errorCode: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: me } = await admin.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  const isPlatformAdmin = me?.primary_role === 'platform_admin'

  const { data: session, error: sErr } = await admin
    .from('sessions')
    .select('id, host_user_id, title')
    .eq('id', sessionId)
    .maybeSingle()

  if (sErr || !session) return json(404, { ok: false, errorCode: 'SESSION_NOT_FOUND' })
  if (session.host_user_id !== user.id && !isPlatformAdmin) {
    return json(403, { ok: false, errorCode: 'FORBIDDEN' })
  }

  const { data: row, error: pErr } = await admin
    .from('session_participants')
    .select(
      'id, session_id, status, is_guest_registration, guest_display_name, session_display_name, registered_by_user_id, notification_user_id, players(auth_user_id, display_name, line_oa_user_id, line_user_id)',
    )
    .eq('id', participantId)
    .maybeSingle()

  if (pErr || !row) return json(404, { ok: false, errorCode: 'PARTICIPANT_NOT_FOUND' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any
  if (String(r.session_id) !== String(sessionId)) {
    return json(400, { ok: false, errorCode: 'SESSION_MISMATCH' })
  }

  const st = String(r.status || '')
  if (['cancelled', 'no_show', 'completed'].includes(st)) {
    return json(400, { ok: false, errorCode: 'PARTICIPANT_STATUS_NOT_CONTACTABLE' })
  }

  const pr = r as ParticipantLineNotifyRow
  const to = await resolveSessionParticipantLinePushTo(admin, pr)
  if (!to) {
    return json(400, { ok: false, errorCode: 'LINE_NOT_BOUND' })
  }

  const sessionTitle = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : '羽球場次'
  const text = buildHostContactLineText(sessionTitle, rawMsg, pr)
  const clipped = text.length > 4800 ? `${text.slice(0, 4790)}…` : text

  const push = await lineMessagingPushText(admin, to, clipped)
  if (!push.ok) {
    if (push.code === 'NO_MESSAGING_TOKEN') {
      return json(503, { ok: false, errorCode: 'NO_MESSAGING_TOKEN', detail: push.detail })
    }
    return json(502, { ok: false, errorCode: 'LINE_API_ERROR', detail: push.detail, status: push.status })
  }

  await auditSessionParticipantContactMessage(admin, user.id, {
    sessionId,
    participantId,
    messageCharCount: rawMsg.length,
  })

  return json(200, { ok: true })
}
