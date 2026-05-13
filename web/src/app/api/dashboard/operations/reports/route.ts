import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { sessionFeeTwd } from '@/lib/operations/sessionOperationReportSession'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

/** GET: 營運報表列表（未 soft delete）；團主僅自己的；platform_admin 全部 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: me } = await admin.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  const isAdmin = me?.primary_role === 'platform_admin'

  let q = admin
    .from('session_operation_reports')
    .select(
      'id, session_id, host_user_id, venue_id, report_date, expected_paid_players, expected_fee_cents, actual_paid_players, actual_fee_cents, venue_cost_cents, shuttlecock_used, shuttlecock_unit_cost_cents, other_income_cents, other_expense_cents, gross_revenue_cents, shuttlecock_cost_cents, net_revenue_cents, note, created_at, updated_at',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!isAdmin) {
    q = q.eq('host_user_id', user.id)
  }

  const { data: reports, error: rErr } = await q
  if (rErr) {
    if (rErr.code === '42P01' || rErr.message.includes('does not exist')) {
      return json(500, { ok: false, error: 'TABLE_MISSING', hint: '執行 docs/083_session_operations_reports.sql' })
    }
    return json(500, { ok: false, error: rErr.message })
  }

  const sessionIds = [...new Set((reports || []).map((r) => r.session_id as string))]
  const venueIds = [...new Set((reports || []).map((r) => r.venue_id as string | null).filter(Boolean))] as string[]

  const { data: sessions } =
    sessionIds.length > 0
      ? await admin.from('sessions').select('id, title, start_at, status').in('id', sessionIds)
      : { data: [] as { id: string; title: string; start_at: string; status: string }[] }

  const { data: venues } =
    venueIds.length > 0 ? await admin.from('venues').select('id, name').in('id', venueIds) : { data: [] as { id: string; name: string }[] }

  const sessionMap = Object.fromEntries((sessions || []).map((s) => [s.id, s]))
  const venueMap = Object.fromEntries((venues || []).map((v) => [v.id, v]))

  const rows = (reports || []).map((r) => ({
    ...r,
    session: sessionMap[r.session_id as string] || null,
    venue: r.venue_id ? venueMap[r.venue_id as string] || null : null,
  }))

  const sumGross = rows.reduce((a, r) => a + Number(r.gross_revenue_cents || 0), 0)
  const sumExpense = rows.reduce((a, r) => {
    const vc = Number((r as { venue_cost_cents?: unknown }).venue_cost_cents ?? 0)
    return a + vc + Number(r.shuttlecock_cost_cents || 0) + Number(r.other_expense_cents || 0)
  }, 0)
  const sumNet = rows.reduce((a, r) => a + Number(r.net_revenue_cents || 0), 0)

  const reportedQ = admin.from('session_operation_reports').select('session_id').is('deleted_at', null)
  const { data: reportedRows, error: repErr } = isAdmin ? await reportedQ : await reportedQ.eq('host_user_id', user.id)
  if (repErr) {
    return json(500, { ok: false, error: repErr.message })
  }
  const reportedSet = new Set((reportedRows || []).map((x) => x.session_id as string))

  let pendingSq = admin
    .from('sessions')
    .select('id, title, start_at, venue_id, host_user_id, fee_twd, max_participants, metadata, status')
    .eq('status', 'session_finished')
    .order('start_at', { ascending: false })
    .limit(200)
  if (!isAdmin) pendingSq = pendingSq.eq('host_user_id', user.id)
  const { data: finishedSessions, error: fsErr } = await pendingSq
  if (fsErr) {
    return json(500, { ok: false, error: fsErr.message })
  }

  const missingRaw = (finishedSessions || []).filter((s) => !reportedSet.has(s.id as string)).slice(0, 50)
  const missingIds = missingRaw.map((s) => s.id as string)

  const mainCountMap = new Map<string, number>()
  if (missingIds.length > 0) {
    const { data: parts } = await admin
      .from('session_participants')
      .select('session_id')
      .in('session_id', missingIds)
      .eq('is_removed', false)
      .eq('status', 'confirmed_main')
    for (const p of parts || []) {
      const sid = p.session_id as string
      mainCountMap.set(sid, (mainCountMap.get(sid) || 0) + 1)
    }
  }

  const pendingVenueIds = [...new Set(missingRaw.map((s) => s.venue_id as string | null).filter(Boolean))] as string[]
  const { data: pendingVenues } =
    pendingVenueIds.length > 0
      ? await admin.from('venues').select('id, name').in('id', pendingVenueIds)
      : { data: [] as { id: string; name: string }[] }
  const pendingVenueMap = Object.fromEntries((pendingVenueIds.length ? pendingVenues || [] : []).map((v) => [v.id, v]))

  const pending_finished_without_report = missingRaw.map((s) => {
    const sid = s.id as string
    const feeTwd = sessionFeeTwd(s)
    return {
      session_id: sid,
      title: s.title as string,
      start_at: s.start_at as string,
      venue_id: (s.venue_id as string | null) ?? null,
      venue: s.venue_id ? pendingVenueMap[s.venue_id as string] || null : null,
      confirmed_main_count: mainCountMap.get(sid) ?? 0,
      fee_twd: feeTwd,
      fee_cents: Math.max(0, Math.round(feeTwd * 100)),
    }
  })

  return json(200, {
    ok: true,
    reports: rows,
    pending_finished_without_report,
    stats: {
      session_count: rows.length,
      gross_revenue_cents: sumGross,
      total_expense_cents: sumExpense,
      net_revenue_cents: sumNet,
    },
  })
}
