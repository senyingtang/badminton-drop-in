import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

function toRateDecimal(default_rate: number | undefined, default_rate_percent: number | undefined): number | null {
  if (default_rate_percent !== undefined && default_rate_percent !== null && Number.isFinite(Number(default_rate_percent))) {
    return Number(default_rate_percent) / 100
  }
  if (default_rate !== undefined && default_rate !== null && Number.isFinite(Number(default_rate))) {
    return Number(default_rate)
  }
  return null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: items, error: iErr } = await admin.from('commission_items').select('*').order('sort_order', { ascending: true })
  if (iErr) return json(500, { ok: false, error: iErr.message })

  const { data: overrides, error: oErr } = await admin
    .from('commission_referrer_item_rates')
    .select('commission_item_id')
    .eq('is_active', true)
  if (oErr) return json(500, { ok: false, error: oErr.message })

  const countMap = new Map<string, number>()
  for (const row of overrides || []) {
    const id = row.commission_item_id as string
    countMap.set(id, (countMap.get(id) || 0) + 1)
  }

  const rows = (items || []).map((row) => ({
    ...row,
    rate_override_count: countMap.get(row.id as string) || 0,
  }))

  return json(200, { ok: true, items: rows })
}

type PostBody = {
  id?: string | null
  item_key: string
  display_name: string
  description?: string | null
  default_rate?: number
  default_rate_percent?: number
  is_active: boolean
  sort_order: number
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const { data: me } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).maybeSingle()
  if (me?.primary_role !== 'platform_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

  const admin = createServiceRoleClient()
  if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const body = (await req.json().catch(() => null)) as Partial<PostBody> | null
  if (!body?.item_key || !String(body.display_name || '').trim()) {
    return json(400, { ok: false, error: 'INVALID_PAYLOAD' })
  }

  const itemKey = String(body.item_key).trim()
  if (!SNAKE.test(itemKey)) return json(400, { ok: false, error: 'INVALID_ITEM_KEY' })

  const rate = toRateDecimal(body.default_rate, body.default_rate_percent)
  if (rate === null || rate < 0 || rate > 1) return json(400, { ok: false, error: 'INVALID_RATE' })

  const displayName = String(body.display_name).trim()
  const sortOrder = Math.floor(Number(body.sort_order ?? 100))
  if (!Number.isFinite(sortOrder)) return json(400, { ok: false, error: 'INVALID_SORT_ORDER' })

  const payload = {
    item_key: itemKey,
    display_name: displayName,
    description: body.description ?? null,
    default_rate: rate,
    is_active: Boolean(body.is_active),
    sort_order: sortOrder,
  }

  let before: Record<string, unknown> | null = null
  const id = body.id ? String(body.id).trim() : ''

  if (id) {
    const { data: prev } = await admin.from('commission_items').select('*').eq('id', id).maybeSingle()
    before = prev ? { ...prev } : null
    const { data: updated, error: uErr } = await admin.from('commission_items').update(payload).eq('id', id).select('*').maybeSingle()
    if (uErr) return json(500, { ok: false, error: uErr.message })
    if (!updated) return json(404, { ok: false, error: 'NOT_FOUND' })

    await admin.from('kb_admin_audit_logs').insert({
      actor_user_id: user.id,
      target_user_id: null,
      action: 'commission_item_upsert',
      entity_type: 'commission_items',
      entity_id: id,
      before_data: before,
      after_data: updated,
      note: 'commission_item_upsert',
    })

    return json(200, { ok: true, item: updated })
  }

  const { data: byKey } = await admin.from('commission_items').select('*').eq('item_key', itemKey).maybeSingle()
  before = byKey ? { ...byKey } : null

  if (byKey) {
    const { data: updated, error: uErr } = await admin.from('commission_items').update(payload).eq('id', byKey.id).select('*').maybeSingle()
    if (uErr) return json(500, { ok: false, error: uErr.message })
    await admin.from('kb_admin_audit_logs').insert({
      actor_user_id: user.id,
      target_user_id: null,
      action: 'commission_item_upsert',
      entity_type: 'commission_items',
      entity_id: byKey.id as string,
      before_data: before,
      after_data: updated,
      note: 'commission_item_upsert:by_item_key',
    })
    return json(200, { ok: true, item: updated })
  }

  const { data: inserted, error: insErr } = await admin.from('commission_items').insert(payload).select('*').maybeSingle()
  if (insErr) return json(500, { ok: false, error: insErr.message })

  await admin.from('kb_admin_audit_logs').insert({
    actor_user_id: user.id,
    target_user_id: null,
    action: 'commission_item_upsert',
    entity_type: 'commission_items',
    entity_id: inserted?.id as string,
    before_data: null,
    after_data: inserted,
    note: 'commission_item_insert',
  })

  return json(200, { ok: true, item: inserted })
}
