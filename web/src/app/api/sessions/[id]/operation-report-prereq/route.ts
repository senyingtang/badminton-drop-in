import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { sessionFeeTwd } from '@/lib/operations/sessionOperationReportSession'
import { getSessionParticipantDisplayName } from '@/lib/sessionParticipantDisplayName'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

/** GET: 結束場次 Modal 預設值 + 是否已有未刪除報表 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: me } = await admin.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  const isAdmin = me?.primary_role === 'platform_admin'

  const { data: session, error: sErr } = await admin
    .from('sessions')
    .select('id, host_user_id, venue_id, title, status, start_at, end_at, fee_twd, max_participants, metadata')
    .eq('id', sessionId)
    .maybeSingle()

  if (sErr || !session) return json(404, { ok: false, error: 'SESSION_NOT_FOUND' })
  if (session.host_user_id !== user.id && !isAdmin) return json(403, { ok: false, error: 'FORBIDDEN' })

  const feeTwd = sessionFeeTwd(session)
  const feeCents = Math.max(0, Math.round(feeTwd * 100))
  const maxParticipants = session.max_participants != null ? Number(session.max_participants) : null

  const { count: confirmedMainCount } = await admin
    .from('session_participants')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('is_removed', false)
    .eq('status', 'confirmed_main')

  const { data: existing } = await admin
    .from('session_operation_reports')
    .select('*')
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .maybeSingle()

  const { data: unpaidRows } = await admin
    .from('session_participants')
    .select(
      'id, session_display_name, guest_display_name, guest_player_code, paid_at, players(display_name)',
    )
    .eq('session_id', sessionId)
    .eq('is_removed', false)
    .eq('status', 'confirmed_main')
    .is('paid_at', null)

  const unpaidConfirmedMain = (unpaidRows || []).map((row) => {
    const players =
      row.players && typeof row.players === 'object' && !Array.isArray(row.players)
        ? (row.players as { display_name?: string | null })
        : null
    return {
      id: String(row.id),
      display_name: getSessionParticipantDisplayName({
        session_participant_id: row.id,
        session_display_name:
          typeof row.session_display_name === 'string' ? row.session_display_name : null,
        guest_display_name:
          typeof row.guest_display_name === 'string' ? row.guest_display_name : null,
        guest_player_code:
          typeof row.guest_player_code === 'string' ? row.guest_player_code : null,
        players,
      }),
    }
  })

  return json(200, {
    ok: true,
    session: {
      id: session.id,
      title: session.title,
      status: session.status,
      venue_id: session.venue_id,
      start_at: session.start_at,
      fee_twd: feeTwd,
      fee_cents: feeCents,
      max_participants: maxParticipants,
    },
    confirmed_main_count: confirmedMainCount ?? 0,
    unpaid_confirmed_main: unpaidConfirmedMain,
    existing_report: existing,
  })
}
