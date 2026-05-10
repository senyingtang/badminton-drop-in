import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
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

  const { data: profiles, error: pErr } = await admin
    .from('member_referral_profiles')
    .select('user_id, referral_code, is_active, created_at')
    .order('created_at', { ascending: false })
  if (pErr) return json(500, { ok: false, error: pErr.message })

  const userIds = (profiles || []).map((r) => r.user_id as string)
  if (userIds.length === 0) return json(200, { ok: true, referrers: [] })

  const { data: appProfiles, error: aErr } = await admin
    .from('app_user_profiles')
    .select('id, display_name, primary_role')
    .in('id', userIds)
  if (aErr) return json(500, { ok: false, error: aErr.message })

  const appById = new Map((appProfiles || []).map((p) => [p.id as string, p]))

  const { data: links, error: lErr } = await admin
    .from('member_referral_links')
    .select('referrer_user_id')
    .eq('status', 'active')
  if (lErr) return json(500, { ok: false, error: lErr.message })

  const linkCount = new Map<string, number>()
  for (const row of links || []) {
    const rid = row.referrer_user_id as string
    linkCount.set(rid, (linkCount.get(rid) || 0) + 1)
  }

  const { data: rateRows, error: rErr } = await admin
    .from('commission_referrer_item_rates')
    .select('referrer_user_id')
    .eq('is_active', true)
  if (rErr) return json(500, { ok: false, error: rErr.message })

  const rateCount = new Map<string, number>()
  for (const row of rateRows || []) {
    const rid = row.referrer_user_id as string
    rateCount.set(rid, (rateCount.get(rid) || 0) + 1)
  }

  const emailById = new Map<string, string>()
  let page = 1
  const perPage = 200
  for (;;) {
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage })
    if (listErr || !listData?.users?.length) break
    for (const u of listData.users) {
      if (u.email && u.id) emailById.set(u.id, u.email)
    }
    if (listData.users.length < perPage) break
    page += 1
    if (page > 50) break
  }

  const referrers = (profiles || []).map((m) => {
    const uid = m.user_id as string
    const ap = appById.get(uid)
    return {
      user_id: uid,
      email: emailById.get(uid) ?? null,
      display_name: ap?.display_name ?? null,
      primary_role: ap?.primary_role ?? null,
      referral_code: m.referral_code as string,
      is_active: m.is_active as boolean,
      created_at: m.created_at as string,
      active_referral_links_count: linkCount.get(uid) || 0,
      personal_rate_overrides_count: rateCount.get(uid) || 0,
    }
  })

  return json(200, { ok: true, referrers })
}
