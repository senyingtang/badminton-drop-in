import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { ParticipantLineNotifyRow } from '@/lib/lineNotifyRecipient'
import { lineMessagingPushText } from '@/lib/lineMessagingPush'
import { buildHostContactLineText, resolveSessionParticipantLinePushTo } from '@/lib/sessionParticipantHostLineMessage'
import { auditSessionParticipantBroadcastMessage } from '@/lib/sessionParticipantMessagingAudit'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

type Body = { participantIds?: unknown; message?: string }

const MAIN_STATUSES = ['confirmed_main', 'promoted_from_waitlist']

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await ctx.params
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json(400, { ok: false, error: 'invalid_json' })
  }

  const rawMsg = typeof body.message === 'string' ? body.message.trim() : ''
  if (!rawMsg) return json(400, { ok: false, error: 'message_required' })
  if (rawMsg.length > 2000) return json(400, { ok: false, error: 'message_too_long' })

  const rawIds = Array.isArray(body.participantIds) ? body.participantIds : []
  const ids = Array.from(
    new Set(
      rawIds
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x) => x.length > 0),
    ),
  )
  if (ids.length === 0) return json(400, { ok: false, error: 'participant_ids_required' })
  if (ids.length > 50) return json(400, { ok: false, error: 'too_many_participants', max: 50 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'unauthorized' })

  const admin = createServiceRoleClient()
  if (!admin) return json(503, { ok: false, error: 'service_role_not_configured' })

  const { data: me } = await admin.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  const isPlatformAdmin = me?.primary_role === 'platform_admin'

  const { data: session, error: sErr } = await admin
    .from('sessions')
    .select('id, host_user_id, title')
    .eq('id', sessionId)
    .maybeSingle()

  if (sErr || !session) return json(404, { ok: false, error: 'session_not_found' })
  if (session.host_user_id !== user.id && !isPlatformAdmin) {
    return json(403, { ok: false, error: 'forbidden' })
  }

  const sessionTitle = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : '羽球場次'

  const results: { participantId: string; ok: boolean; errorCode?: string }[] = []
  let sent = 0
  let failed = 0

  for (const participantId of ids) {
    const { data: row, error: pErr } = await admin
      .from('session_participants')
      .select(
        'id, session_id, status, is_guest_registration, guest_display_name, session_display_name, registered_by_user_id, notification_user_id, players(auth_user_id, display_name, line_oa_user_id, line_user_id)',
      )
      .eq('id', participantId)
      .maybeSingle()

    if (pErr || !row) {
      results.push({ participantId, ok: false, errorCode: 'PARTICIPANT_NOT_FOUND' })
      failed += 1
      continue
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any
    if (String(r.session_id) !== String(sessionId)) {
      results.push({ participantId, ok: false, errorCode: 'SESSION_MISMATCH' })
      failed += 1
      continue
    }

    const st = String(r.status || '')
    if (!MAIN_STATUSES.includes(st)) {
      results.push({ participantId, ok: false, errorCode: 'NOT_MAIN_ROSTER' })
      failed += 1
      continue
    }

    const pr = r as ParticipantLineNotifyRow
    const to = await resolveSessionParticipantLinePushTo(admin, pr)
    if (!to) {
      results.push({ participantId, ok: false, errorCode: 'LINE_NOT_BOUND' })
      failed += 1
      continue
    }

    const text = buildHostContactLineText(sessionTitle, rawMsg, pr)
    const clipped = text.length > 4800 ? `${text.slice(0, 4790)}…` : text

    const push = await lineMessagingPushText(admin, to, clipped)
    if (!push.ok) {
      if (push.code === 'NO_MESSAGING_TOKEN') {
        results.push({ participantId, ok: false, errorCode: 'NO_MESSAGING_TOKEN' })
      } else {
        results.push({ participantId, ok: false, errorCode: 'LINE_API_ERROR' })
      }
      failed += 1
      continue
    }

    results.push({ participantId, ok: true })
    sent += 1
  }

  await auditSessionParticipantBroadcastMessage(admin, user.id, {
    sessionId,
    participantIds: ids,
    sent,
    failed,
    messageCharCount: rawMsg.length,
    results,
  })

  return json(200, { sent, failed, results })
}
