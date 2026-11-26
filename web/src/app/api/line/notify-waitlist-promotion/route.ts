import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  fetchLinePushToForAppUserId,
  lineNotifySubjectName,
  pickNotifyRecipientUserId,
  type ParticipantLineNotifyRow,
} from '@/lib/lineNotifyRecipient'
import { pushLineNotify } from '@/lib/lineNotifyPush'

export const runtime = 'nodejs'

type Body = { sessionParticipantId?: string }

/**
 * 主辦將候補改為正選後，以 LINE Messaging API 推播提醒。
 * 收件者：notification_user_id → registered_by_user_id → 參與者本人 players → 其 LINE 綁定。
 */
export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const sessionParticipantId = body.sessionParticipantId?.trim()
  if (!sessionParticipantId) {
    return NextResponse.json({ ok: false, error: 'missing_session_participant_id' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: row, error: rowErr } = await supabase
    .from('session_participants')
    .select(
      'id, session_id, player_id, status, is_guest_registration, guest_display_name, session_display_name, registered_by_user_id, notification_user_id, players(line_oa_user_id, line_user_id, display_name, auth_user_id), sessions!inner(host_user_id, title)'
    )
    .eq('id', sessionParticipantId)
    .maybeSingle()

  if (rowErr || !row) {
    return NextResponse.json({ ok: false, error: 'participant_not_found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any
  const hostId = r.sessions?.host_user_id as string | undefined
  if (hostId !== user.id) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  if (r.status !== 'confirmed_main' && r.status !== 'promoted_from_waitlist') {
    return NextResponse.json({ ok: true, skipped: 'not_main_status' })
  }

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'service_role_not_configured' }, { status: 503 })
  }

  const pr = r as ParticipantLineNotifyRow
  const notifyUid = pickNotifyRecipientUserId(pr)
  const to = notifyUid ? await fetchLinePushToForAppUserId(admin, notifyUid) : ''
  if (!to) {
    return NextResponse.json({ ok: true, skipped: 'no_line_binding' })
  }

  const sessionTitle = (r.sessions?.title as string) || '羽球場次'
  const subject = lineNotifySubjectName(pr)
  const isGuestAssist = Boolean(r.is_guest_registration)
  const text = isGuestAssist
    ? `【報名通知】您協助報名的球友「${subject}」已從候補晉升為「${sessionTitle}」正選名單，請記得提醒對方準時到場。若有疑問請聯絡主辦。`
    : `【報名通知】${subject} 您好：您已從候補晉升為「${sessionTitle}」正選名單，請記得準時到場。若有疑問請聯絡主辦。`

  const pushed = await pushLineNotify(admin, {
    kind: 'waitlist_promotion',
    to,
    text,
    sessionParticipantId,
    sessionId: (r.session_id as string) ?? null,
    actorUserId: user.id,
  })
  if (!pushed.ok) {
    return NextResponse.json(
      { ok: false, error: pushed.code, status: pushed.status, requestId: pushed.requestId },
      { status: pushed.code === 'LINE_NO_MESSAGING_TOKEN' ? 503 : 502 }
    )
  }
  return NextResponse.json({ ok: true, requestId: pushed.requestId })
}
