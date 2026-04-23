import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type Body = { sessionParticipantId?: string }

/**
 * 球員完成報名後，若已綁定 LINE@（players.line_oa_user_id）則推播「報名成功」通知。
 * - 注意：此通知屬於「自我確認」，若未綁定則跳過。
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

  // 讀取參與紀錄 + 確認是本人（players.auth_user_id = user.id）
  const { data: row, error: rowErr } = await admin
    .from('session_participants')
    .select('id, status, sessions(title), players(auth_user_id, display_name, line_oa_user_id, line_user_id)')
    .eq('id', sessionParticipantId)
    .maybeSingle()

  if (rowErr || !row) return NextResponse.json({ ok: false, error: 'participant_not_found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any
  const authUserId = r.players?.auth_user_id as string | undefined
  if (authUserId !== user.id) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const to =
    (r.players?.line_oa_user_id as string | null | undefined) ||
    (r.players?.line_user_id as string | null | undefined) ||
    ''
  if (!to) return NextResponse.json({ ok: true, skipped: 'no_line_binding' })

  const { data: cfg } = await admin
    .from('platform_line_integration')
    .select('messaging_channel_access_token')
    .eq('id', 1)
    .maybeSingle()

  const token = typeof (cfg as any)?.messaging_channel_access_token === 'string' ? (cfg as any).messaging_channel_access_token.trim() : ''
  if (!token) return NextResponse.json({ ok: true, skipped: 'no_messaging_token' })

  const sessionTitle = (r.sessions?.title as string) || '羽球場次'
  const name = (r.players?.display_name as string) || '球友'
  const isWaitlist = r.status === 'waitlist'
  const text = isWaitlist
    ? `【報名成功】${name} 您好：您已成功報名「${sessionTitle}」，目前為候補名單。若候補轉正選，系統會再通知您。`
    : `【報名成功】${name} 您好：您已成功報名「${sessionTitle}」，目前為正選名單。請記得準時到場。`

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

