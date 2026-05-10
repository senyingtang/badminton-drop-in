import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function currentMonthFirstLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

function parseMonth(ym: string | null): string {
  if (ym && /^\d{4}-\d{2}$/.test(ym)) return `${ym}-01`
  return currentMonthFirstLocal()
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const url = new URL(req.url)
  const month = parseMonth(url.searchParams.get('month')?.trim() || null)

  const { data: prof } = await supabase.from('member_referral_profiles').select('referral_code').eq('user_id', user.id).maybeSingle()

  const { data: rows, error } = await supabase
    .from('commission_events')
    .select('id, commission_amount_cents, status, event_type, created_at, commission_item_display_name')
    .eq('referrer_user_id', user.id)
    .eq('commission_month', month)
    .order('created_at', { ascending: false })

  if (error) return json(500, { ok: false, error: error.message })

  const list = rows || []
  let estimated = 0
  let effectiveCount = 0
  let adjustmentCount = 0
  let voidedCount = 0

  for (const r of list) {
    if (r.status === 'effective') {
      estimated += Number(r.commission_amount_cents || 0)
      effectiveCount += 1
    }
    if (r.event_type === 'adjustment') adjustmentCount += 1
    if (r.status === 'voided') voidedCount += 1
  }

  const eventsRecent = list.slice(0, 10)

  return json(200, {
    ok: true,
    referral_code: prof?.referral_code ?? null,
    month: month.slice(0, 7),
    estimated_commission_cents: estimated,
    effective_count: effectiveCount,
    adjustment_count: adjustmentCount,
    voided_count: voidedCount,
    events_recent: eventsRecent,
    message: '此金額為預估分潤，實際請款以後台結算為準。',
  })
}
