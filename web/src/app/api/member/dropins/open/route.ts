import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { parseTaiwanAddress } from '@/lib/taiwanAddress'
import { buildSessionCourtSlots, formatCourtSlotTitle } from '@/lib/session-court-slots'

export const runtime = 'nodejs'

/** 本頁僅列出「明確仍開放報名」狀態；與 DB enum 一致，不加入未存在的別名。 */
const OPEN_REGISTRATION_STATUSES = ['registration_open'] as const

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function sessionFeeTwd(row: {
  fee_twd?: unknown
  metadata?: unknown
}): number {
  const m = row?.metadata
  if (m && typeof m === 'object' && (m as { fee_twd?: unknown }).fee_twd != null) {
    const n = Number((m as { fee_twd?: unknown }).fee_twd)
    return Number.isFinite(n) ? n : 0
  }
  if (row?.fee_twd != null) return Number(row.fee_twd) || 0
  return 0
}

function formatSessionDateTime(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime())) return startIso
  const d = start.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const t1 = start.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
  const t2 = end.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${d} ${t1}–${t2}`
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: sessions, error: sErr } = await admin
    .from('sessions')
    .select(
      'id, title, status, start_at, end_at, venue_id, share_signup_code, metadata, fee_twd, fee_description, court_count'
    )
    .eq('allow_self_signup', true)
    .not('share_signup_code', 'is', null)
    .in('status', [...OPEN_REGISTRATION_STATUSES])
    .order('start_at', { ascending: true })

  if (sErr) return json(500, { ok: false, error: sErr.message })

  const list = sessions || []
  const venueIds = [...new Set(list.map((s) => s.venue_id).filter(Boolean))] as string[]
  const sessionIds = list.map((s) => s.id)

  const venueMap = new Map<
    string,
    { id: string; name: string; address_text: string | null; city: string | null; district: string | null }
  >()
  if (venueIds.length > 0) {
    const { data: venues, error: vErr } = await admin
      .from('venues')
      .select('id, name, address_text, city, district')
      .in('id', venueIds)
    if (vErr) return json(500, { ok: false, error: vErr.message })
    for (const v of venues || []) {
      venueMap.set(v.id, v)
    }
  }

  const courtsBySession = new Map<string, Array<{ sort_order: number; court_no: number; label: string | null }>>()
  if (sessionIds.length > 0) {
    const { data: courtRows, error: cErr } = await admin
      .from('session_courts')
      .select('session_id, sort_order, court_no, label')
      .in('session_id', sessionIds)
    if (cErr) return json(500, { ok: false, error: cErr.message })
    for (const r of courtRows || []) {
      const sid = r.session_id as string
      if (!courtsBySession.has(sid)) courtsBySession.set(sid, [])
      courtsBySession.get(sid)!.push({
        sort_order: Number(r.sort_order),
        court_no: Number(r.court_no),
        label: typeof r.label === 'string' ? r.label : null,
      })
    }
    for (const [, arr] of courtsBySession) {
      arr.sort((a, b) => a.sort_order - b.sort_order)
    }
  }

  const items = list.map((s) => {
    const code = typeof s.share_signup_code === 'string' ? s.share_signup_code.trim() : ''
    const venue = s.venue_id ? venueMap.get(s.venue_id as string) : undefined
    const addrParts = [
      venue?.city?.trim(),
      venue?.district?.trim(),
      venue?.address_text?.trim(),
    ].filter(Boolean)
    const addressLine = addrParts.length > 0 ? addrParts.join(' ') : ''

    const parsed = parseTaiwanAddress(venue?.address_text ?? null, venue?.city ?? null, venue?.district ?? null)

    const slots = buildSessionCourtSlots(
      courtsBySession.get(s.id) ?? null,
      Number(s.court_count) || 1,
      s.metadata
    )
    const courts = slots.map((slot) => formatCourtSlotTitle(slot))

    const feeNum = sessionFeeTwd(s)
    const feeDesc = typeof s.fee_description === 'string' ? s.fee_description.trim() : ''
    const feeDisplay = feeNum > 0 ? `NT$ ${feeNum.toLocaleString('zh-TW')}` : null

    return {
      id: s.id,
      title: s.title,
      status: s.status,
      statusLabel: '報名中',
      venueName: venue?.name ?? '（未指定場館）',
      address: addressLine || '—',
      parsedCity: parsed.city,
      parsedDistrict: parsed.district,
      courts,
      feeDisplay,
      feeNote: feeDesc || null,
      levelDisplay: null as string | null,
      shareSignupCode: code || null,
      dateTimeDisplay: formatSessionDateTime(s.start_at as string, s.end_at as string),
      startAt: s.start_at,
    }
  })

  return json(200, { ok: true, sessions: items })
}
