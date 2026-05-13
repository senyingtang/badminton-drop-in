import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { computeSessionOperationReportAmounts } from '@/lib/operations/sessionOperationReportMath'
import { auditSessionOperationReport } from '@/lib/operations/sessionOperationReportAudit'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

async function assertReportAccess(admin: NonNullable<ReturnType<typeof createServiceRoleClient>>, userId: string, reportId: string) {
  const { data: me } = await admin.from('app_user_profiles').select('primary_role').eq('id', userId).maybeSingle()
  const isAdmin = me?.primary_role === 'platform_admin'
  const { data: row, error } = await admin.from('session_operation_reports').select('*').eq('id', reportId).maybeSingle()
  if (error || !row) return { ok: false as const, status: 404 as const, error: 'NOT_FOUND' }
  if (row.host_user_id !== userId && !isAdmin) return { ok: false as const, status: 403 as const, error: 'FORBIDDEN' }
  return { ok: true as const, row, isAdmin }
}

type PatchBody = {
  actual_paid_players?: number
  actual_fee_cents?: number
  expected_paid_players?: number | null
  expected_fee_cents?: number | null
  shuttlecock_used?: number | null
  shuttlecock_unit_cost_cents?: number | null
  other_income_cents?: number
  other_expense_cents?: number
  note?: string | null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: reportId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const gate = await assertReportAccess(admin, user.id, reportId)
  if (!gate.ok) return json(gate.status, { ok: false, error: gate.error })

  const before = gate.row
  if (before.deleted_at) return json(400, { ok: false, error: 'REPORT_DELETED' })

  const body = (await req.json().catch(() => ({}))) as PatchBody

  const actualPaidPlayers = Math.max(0, Math.floor(Number(body.actual_paid_players ?? before.actual_paid_players ?? 0)))
  const actualFeeCents = Math.max(0, Math.floor(Number(body.actual_fee_cents ?? before.actual_fee_cents ?? 0)))
  const expectedPaidPlayers =
    body.expected_paid_players !== undefined
      ? body.expected_paid_players == null
        ? null
        : Math.max(0, Math.floor(Number(body.expected_paid_players)))
      : (before.expected_paid_players as number | null)
  const expectedFeeCents =
    body.expected_fee_cents !== undefined
      ? body.expected_fee_cents == null
        ? null
        : Math.max(0, Math.floor(Number(body.expected_fee_cents)))
      : (before.expected_fee_cents as number | null)

  const shuttleUsed =
    body.shuttlecock_used !== undefined
      ? body.shuttlecock_used == null || String(body.shuttlecock_used).trim() === ''
        ? null
        : Number(body.shuttlecock_used)
      : before.shuttlecock_used != null
        ? Number(before.shuttlecock_used)
        : null
  const shuttleUnit =
    body.shuttlecock_unit_cost_cents !== undefined
      ? body.shuttlecock_unit_cost_cents == null
        ? null
        : Math.max(0, Math.floor(Number(body.shuttlecock_unit_cost_cents)))
      : before.shuttlecock_unit_cost_cents != null
        ? Math.max(0, Math.floor(Number(before.shuttlecock_unit_cost_cents)))
        : null

  const otherIncomeCents = Math.max(
    0,
    Math.floor(Number(body.other_income_cents ?? before.other_income_cents ?? 0)),
  )
  const otherExpenseCents = Math.max(
    0,
    Math.floor(Number(body.other_expense_cents ?? before.other_expense_cents ?? 0)),
  )

  const computed = computeSessionOperationReportAmounts({
    actualPaidPlayers,
    actualFeeCents,
    shuttlecockUsed: shuttleUsed,
    shuttlecockUnitCostCents: shuttleUnit,
    otherIncomeCents,
    otherExpenseCents,
  })

  const note = body.note !== undefined ? body.note?.trim() || null : (before.note as string | null)

  const { data: after, error: uErr } = await admin
    .from('session_operation_reports')
    .update({
      expected_paid_players: expectedPaidPlayers,
      expected_fee_cents: expectedFeeCents,
      actual_paid_players: actualPaidPlayers,
      actual_fee_cents: actualFeeCents,
      shuttlecock_used: shuttleUsed,
      shuttlecock_unit_cost_cents: shuttleUnit,
      other_income_cents: otherIncomeCents,
      other_expense_cents: otherExpenseCents,
      gross_revenue_cents: computed.grossRevenueCents,
      shuttlecock_cost_cents: computed.shuttlecockCostCents,
      net_revenue_cents: computed.netRevenueCents,
      note,
      updated_by_user_id: user.id,
    })
    .eq('id', reportId)
    .select('*')
    .maybeSingle()

  if (uErr) return json(500, { ok: false, error: uErr.message })

  await auditSessionOperationReport(admin, user.id, 'session_operation_report_update', {
    entityId: reportId,
    before,
    after,
  })

  return json(200, { ok: true, report: after })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: reportId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const gate = await assertReportAccess(admin, user.id, reportId)
  if (!gate.ok) return json(gate.status, { ok: false, error: gate.error })

  const before = gate.row
  if (before.deleted_at) return json(200, { ok: true, already_deleted: true })

  const { data: after, error: uErr } = await admin
    .from('session_operation_reports')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .eq('id', reportId)
    .select('*')
    .maybeSingle()

  if (uErr) return json(500, { ok: false, error: uErr.message })

  await auditSessionOperationReport(admin, user.id, 'session_operation_report_delete', {
    entityId: reportId,
    before,
    after,
  })

  return json(200, { ok: true, report: after })
}
