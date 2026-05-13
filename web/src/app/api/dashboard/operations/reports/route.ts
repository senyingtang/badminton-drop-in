import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

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
      'id, session_id, host_user_id, venue_id, report_date, expected_paid_players, expected_fee_cents, actual_paid_players, actual_fee_cents, shuttlecock_used, shuttlecock_unit_cost_cents, other_income_cents, other_expense_cents, gross_revenue_cents, shuttlecock_cost_cents, net_revenue_cents, note, created_at, updated_at',
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
  const sumExpense = rows.reduce((a, r) => a + Number(r.shuttlecock_cost_cents || 0) + Number(r.other_expense_cents || 0), 0)
  const sumNet = rows.reduce((a, r) => a + Number(r.net_revenue_cents || 0), 0)

  return json(200, {
    ok: true,
    reports: rows,
    stats: {
      session_count: rows.length,
      gross_revenue_cents: sumGross,
      total_expense_cents: sumExpense,
      net_revenue_cents: sumNet,
    },
  })
}
