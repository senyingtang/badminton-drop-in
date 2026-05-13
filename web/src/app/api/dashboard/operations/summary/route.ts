import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  buildOperationsSummary,
  parseOperationsSummaryRange,
  type RawOpReport,
} from '@/lib/operations/buildOperationsSummary'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

/** GET: 總覽用營運報表 KPI + 圖表點（依 range 聚合）；不影響 /operations 列表 API。 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: me } = await admin.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  const isAdmin = me?.primary_role === 'platform_admin'

  const url = new URL(req.url)
  const range = parseOperationsSummaryRange(url.searchParams.get('range'))

  let q = admin
    .from('session_operation_reports')
    .select(
      'id, session_id, report_date, created_at, gross_revenue_cents, venue_cost_cents, shuttlecock_cost_cents, other_expense_cents, net_revenue_cents',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(800)

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

  const rows = (reports || []) as RawOpReport[]
  const sessionIds = [...new Set(rows.map((r) => r.session_id))]

  const { data: sessions } =
    sessionIds.length > 0
      ? await admin.from('sessions').select('id, title').in('id', sessionIds)
      : { data: [] as { id: string; title: string }[] }

  const sessionTitleById: Record<string, string> = Object.fromEntries(
    (sessions || []).map((s) => [s.id, s.title || '']),
  )

  const { stats, chart_points } = buildOperationsSummary(range, rows, sessionTitleById)

  return json(200, {
    ok: true,
    range,
    fetched_report_count: rows.length,
    stats,
    chart_points,
  })
}
