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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 報名成功後推播（LINE Messaging）。
 * - 一般報名：通知參與者本人（players LINE 綁定）。
 * - 代朋友報名：通知 notification／registered_by 指定之會員（其 players LINE 綁定）。
 */
export async function POST(req: Request) {
  let body: Body | null = null
  try {
    body = (await req.json()) as Body
  } catch {
    body = null
  }

  const sessionParticipantId = body?.sessionParticipantId?.trim() || ''
  if (!sessionParticipantId) {
    return NextResponse.json({ ok: false, error: 'missing_session_participant_id' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const admin = createServiceRoleClient()
  if (!admin) return NextResponse.json({ ok: false, error: 'service_role_not_configured' }, { status: 503 })

  const { data: row, error: rowErr } = await admin
    .from('session_participants')
    .select(
      'id, session_id, status, is_guest_registration, guest_display_name, session_display_name, registered_by_user_id, notification_user_id, sessions(title), players(auth_user_id, display_name, line_oa_user_id, line_user_id)'
    )
    .eq('id', sessionParticipantId)
    .maybeSingle()

  if (rowErr || !row) return NextResponse.json({ ok: false, error: 'participant_not_found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any as ParticipantLineNotifyRow & { status?: string; sessions?: { title?: string } }

  const authUserId = r.players?.auth_user_id as string | undefined
  const isGuest = Boolean(r.is_guest_registration)
  const allowed =
    (!isGuest && authUserId === user.id) ||
    (isGuest && (r.registered_by_user_id === user.id || r.notification_user_id === user.id))
  if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const notifyUid = pickNotifyRecipientUserId(r)
  const to = notifyUid ? await fetchLinePushToForAppUserId(admin, notifyUid) : ''
  if (!to) return NextResponse.json({ ok: true, skipped: 'no_line_binding' })

  const sessionTitle = (r.sessions?.title as string) || '羽球場次'
  const subject = lineNotifySubjectName(r)
  const isWaitlist = r.status === 'waitlist'

  let text: string
  if (isGuest) {
    text = isWaitlist
      ? `【報名成功】您協助報名的球友「${subject}」已成功報名「${sessionTitle}」，目前為候補名單。若候補轉正選，系統會再通知您。`
      : `【報名成功】您協助報名的球友「${subject}」已成功報名「${sessionTitle}」，目前為正選名單。請提醒對方準時到場。`
  } else {
    text = isWaitlist
      ? `【報名成功】${subject} 您好：您已成功報名「${sessionTitle}」，目前為候補名單。若候補轉正選，系統會再通知您。`
      : `【報名成功】${subject} 您好：您已成功報名「${sessionTitle}」，目前為正選名單。請記得準時到場。`
  }

  // 報名列 id 作為 X-Line-Retry-Key：同一筆報名重複呼叫也只會送一則
  const pushed = await pushLineNotify(admin, {
    kind: 'signup',
    to,
    text,
    sessionParticipantId,
    sessionId: (row as { session_id?: string }).session_id ?? null,
    actorUserId: user.id,
    retryKey: UUID_RE.test(sessionParticipantId) ? sessionParticipantId.toLowerCase() : null,
  })
  if (!pushed.ok) {
    return NextResponse.json(
      { ok: false, error: pushed.code, status: pushed.status, requestId: pushed.requestId },
      { status: pushed.code === 'LINE_NO_MESSAGING_TOKEN' ? 503 : 502 }
    )
  }
  return NextResponse.json({ ok: true, requestId: pushed.requestId, duplicate: pushed.duplicate })
}
