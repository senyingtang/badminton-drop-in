import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function toDisplayName(u: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const metaName = typeof u.user_metadata?.display_name === 'string' ? u.user_metadata.display_name.trim() : ''
  if (metaName) return metaName
  const email = typeof u.email === 'string' ? u.email : ''
  if (email && email.includes('@')) return email.split('@')[0]
  return '球友'
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'service_role_not_configured' }, { status: 503 })
  }

  const { data: existing } = await admin.from('players').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (existing?.id) return NextResponse.json({ ok: true, created: false, player_id: existing.id })

  const codeNoDash = String(user.id).replace(/-/g, '')
  const playerCode = `u${codeNoDash}`
  const displayName = toDisplayName(user)
  const fallbackCode = `u${crypto.randomUUID().replace(/-/g, '')}`

  const { data: inserted, error: insErr } = await admin
    .from('players')
    .insert({ auth_user_id: user.id, player_code: playerCode, display_name: displayName })
    .select('id')
    .maybeSingle()

  if (insErr || !inserted) {
    const { data: inserted2, error: insErr2 } = await admin
      .from('players')
      .insert({ auth_user_id: user.id, player_code: fallbackCode, display_name: displayName })
      .select('id')
      .maybeSingle()
    if (insErr2 || !inserted2) {
      return NextResponse.json(
        { ok: false, error: 'create_failed', detail: insErr2?.message || insErr?.message || 'unknown' },
        { status: 400 }
      )
    }
    return NextResponse.json({ ok: true, created: true, player_id: inserted2.id })
  }

  return NextResponse.json({ ok: true, created: true, player_id: inserted.id })
}

