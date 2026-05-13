import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { computeSessionOperationReportAmounts } from '@/lib/operations/sessionOperationReportMath'
import { auditSessionOperationReport } from '@/lib/operations/sessionOperationReportAudit'
import { reportDateTaipei, sessionFeeTwd } from '@/lib/operations/sessionOperationReportSession'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

type Body = {
  actual_paid_players?: number
  actual_fee_cents?: number
  expected_paid_players?: number | null
  expected_fee_cents?: number | null
  venue_cost_cents?: number
  shuttlecock_used?: number | null
  shuttlecock_unit_cost_cents?: number | null
  other_income_cents?: number
  other_expense_cents?: number
  note?: string | null
}

/** POST: 已結束場次補建立營運報表（不變更 session 狀態） */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    .select('id, host_user_id, venue_id, title, status, start_at, fee_twd, max_participants, metadata')
    .eq('id', sessionId)
    .maybeSingle()

  if (sErr || !session) return json(404, { ok: false, error: 'SESSION_NOT_FOUND' })
  if (session.host_user_id !== user.id && !isAdmin) return json(403, { ok: false, error: 'FORBIDDEN' })

  if (session.status !== 'session_finished') {
    return json(400, { ok: false, error: 'SESSION_NOT_FINISHED', status: session.status })
  }

  const { data: existing } = await admin
    .from('session_operation_reports')
    .select('id')
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing?.id) {
    return json(409, { ok: false, error: 'REPORT_ALREADY_EXISTS', report_id: existing.id })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const actualPaidPlayers = Math.max(0, Math.floor(Number(body.actual_paid_players ?? 0)))
  const actualFeeCents = Math.max(0, Math.floor(Number(body.actual_fee_cents ?? 0)))

  const defaultFeeCents = Math.max(0, Math.round(sessionFeeTwd(session) * 100))
  const defaultExpectedPlayers = session.max_participants != null ? Math.max(0, Number(session.max_participants)) : null

  const expectedPaidPlayers =
    body.expected_paid_players != null && Number.isFinite(Number(body.expected_paid_players))
      ? Math.max(0, Math.floor(Number(body.expected_paid_players)))
      : defaultExpectedPlayers
  const expectedFeeCents =
    body.expected_fee_cents != null && Number.isFinite(Number(body.expected_fee_cents))
      ? Math.max(0, Math.floor(Number(body.expected_fee_cents)))
      : defaultFeeCents

  const shuttleUsed =
    body.shuttlecock_used != null && String(body.shuttlecock_used).trim() !== '' ? Number(body.shuttlecock_used) : null
  const shuttleUnit =
    body.shuttlecock_unit_cost_cents != null && Number.isFinite(Number(body.shuttlecock_unit_cost_cents))
      ? Math.max(0, Math.floor(Number(body.shuttlecock_unit_cost_cents)))
      : null

  const otherIncomeCents = Math.max(0, Math.floor(Number(body.other_income_cents ?? 0)))
  const otherExpenseCents = Math.max(0, Math.floor(Number(body.other_expense_cents ?? 0)))
  const venueCostCents = Math.max(0, Math.floor(Number(body.venue_cost_cents ?? 0)))

  const computed = computeSessionOperationReportAmounts({
    actualPaidPlayers,
    actualFeeCents,
    venueCostCents,
    shuttlecockUsed: shuttleUsed,
    shuttlecockUnitCostCents: shuttleUnit,
    otherIncomeCents,
    otherExpenseCents,
  })

  const reportDate = reportDateTaipei(String(session.start_at))

  const insertRow = {
    session_id: sessionId,
    host_user_id: session.host_user_id as string,
    venue_id: (session.venue_id as string | null) ?? null,
    report_date: reportDate,
    expected_paid_players: expectedPaidPlayers,
    expected_fee_cents: expectedFeeCents,
    actual_paid_players: actualPaidPlayers,
    actual_fee_cents: actualFeeCents,
    shuttlecock_used: shuttleUsed,
    shuttlecock_unit_cost_cents: shuttleUnit,
    other_income_cents: otherIncomeCents,
    other_expense_cents: otherExpenseCents,
    venue_cost_cents: venueCostCents,
    gross_revenue_cents: computed.grossRevenueCents,
    shuttlecock_cost_cents: computed.shuttlecockCostCents,
    net_revenue_cents: computed.netRevenueCents,
    note: body.note?.trim() || null,
    source: 'dashboard_backfill',
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  }

  const { data: ins, error: iErr } = await admin.from('session_operation_reports').insert(insertRow).select('*').maybeSingle()

  if (iErr) {
    if (iErr.code === '23505') {
      return json(409, { ok: false, error: 'REPORT_ALREADY_EXISTS' })
    }
    return json(500, { ok: false, error: iErr.message })
  }

  const reportId = (ins?.id as string) || ''
  await auditSessionOperationReport(admin, user.id, 'session_operation_report_backfill_create', {
    entityId: reportId,
    after: { session_id: sessionId, report: ins },
  })

  return json(200, { ok: true, report_id: reportId, report: ins })
}
