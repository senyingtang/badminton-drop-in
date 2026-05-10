import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function monthFirstDay(ym: string | null): string | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null
  return `${ym}-01`
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const url = new URL(req.url)
  const month = monthFirstDay(url.searchParams.get('month')?.trim() || null)
  const referrerUserId = url.searchParams.get('referrerUserId')?.trim() || null
  const referredUserId = url.searchParams.get('referredUserId')?.trim() || null
  const itemKey = url.searchParams.get('itemKey')?.trim() || null
  const status = url.searchParams.get('status')?.trim() || null
  const eventType = url.searchParams.get('eventType')?.trim() || null
  const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('limit') || '50'))))
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset') || '0')))

  let q = admin.from('commission_events').select('*').order('created_at', { ascending: false })
  if (month) q = q.eq('commission_month', month)
  if (referrerUserId) q = q.eq('referrer_user_id', referrerUserId)
  if (referredUserId) q = q.eq('referred_user_id', referredUserId)
  if (itemKey) q = q.eq('commission_item_key', itemKey)
  if (status) q = q.eq('status', status as 'pending' | 'effective' | 'voided' | 'adjusted')
  if (eventType) q = q.eq('event_type', eventType as 'earned' | 'adjustment' | 'reversal')

  const { data: events, error: eErr } = await q.range(offset, offset + limit - 1)
  if (eErr) return json(500, { ok: false, error: eErr.message })

  const { data: sumRow, error: sErr } = await admin.rpc('commission_events_admin_summary', {
    p_commission_month: month,
    p_referrer_user_id: referrerUserId,
    p_referred_user_id: referredUserId,
    p_commission_item_key: itemKey,
    p_status: status,
    p_event_type: eventType,
  })
  if (sErr) return json(500, { ok: false, error: sErr.message })

  const summary = (sumRow as Record<string, unknown> | null) || {}

  return json(200, { ok: true, events: events || [], summary })
}
