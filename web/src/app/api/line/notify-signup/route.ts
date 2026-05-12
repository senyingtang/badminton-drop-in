import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  fetchLinePushToForAppUserId,
  lineNotifySubjectName,
  pickNotifyRecipientUserId,
  type ParticipantLineNotifyRow,
} from '@/lib/lineNotifyRecipient'

export const runtime = 'nodejs'

type Body = { sessionParticipantId?: string }

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
      'id, status, is_guest_registration, guest_display_name, session_display_name, registered_by_user_id, notification_user_id, sessions(title), players(auth_user_id, display_name, line_oa_user_id, line_user_id)'
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

  const { data: cfg } = await admin
    .from('platform_line_integration')
    .select('messaging_channel_access_token')
    .eq('id', 1)
    .maybeSingle()

  const token = typeof (cfg as { messaging_channel_access_token?: string })?.messaging_channel_access_token === 'string'
    ? String((cfg as { messaging_channel_access_token: string }).messaging_channel_access_token).trim()
    : ''
  if (!token) return NextResponse.json({ ok: true, skipped: 'no_messaging_token' })

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

  const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  })

  if (!lineRes.ok) {
    const errText = await lineRes.text()
    console.error('LINE signup push failed', lineRes.status, errText)
    return NextResponse.json({ ok: false, error: 'line_api_error', status: lineRes.status }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
