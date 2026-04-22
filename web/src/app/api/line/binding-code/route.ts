import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function randomCode(len = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 避免 0/O/1/I
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const admin = createServiceRoleClient()
  if (!admin) return NextResponse.json({ ok: false, error: 'service_role_not_configured' }, { status: 503 })

  // 1) 找到或建立 players（避免使用者只登入但沒有 player 記錄時無法綁定）
  const { data: existingPlayer } = await admin
    .from('players')
    .select('id, line_oa_user_id, line_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  let playerId = existingPlayer?.id as string | undefined
  if (!playerId) {
    const codeNoDash = String(user.id).replace(/-/g, '')
    const playerCode = `u${codeNoDash}`
    const fallbackCode = `u${crypto.randomUUID().replace(/-/g, '')}`
    const displayName =
      (typeof (user as any)?.user_metadata?.display_name === 'string' &&
        (user as any).user_metadata.display_name.trim()) ||
      (typeof user.email === 'string' ? user.email.split('@')[0] : '') ||
      '球友'

    const { data: ins, error: insErr } = await admin
      .from('players')
      .insert({ auth_user_id: user.id, player_code: playerCode, display_name: displayName })
      .select('id')
      .maybeSingle()

    if (insErr || !ins) {
      const { data: ins2, error: ins2Err } = await admin
        .from('players')
        .insert({ auth_user_id: user.id, player_code: fallbackCode, display_name: displayName })
        .select('id')
        .maybeSingle()
      if (ins2Err || !ins2) {
        return NextResponse.json({ ok: false, error: 'create_player_failed' }, { status: 500 })
      }
      playerId = ins2.id as string
    } else {
      playerId = ins.id as string
    }
  }

  // 已綁定就直接回傳狀態
  const boundLineOaUserId =
    (existingPlayer as any)?.line_oa_user_id || (existingPlayer as any)?.line_user_id || null
  if (boundLineOaUserId) {
    return NextResponse.json({ ok: true, bound: true, lineOaUserId: boundLineOaUserId })
  }

  // 2) 產生新的綁定碼（短效 10 分鐘）
  // 為避免碰撞，最多嘗試幾次
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  let lastErr: unknown = null
  for (let i = 0; i < 5; i++) {
    const code = randomCode(6)
    const { error } = await admin.from('line_oa_binding_codes').insert({
      code,
      player_id: playerId,
      expires_at: expiresAt.toISOString(),
    })
    if (!error) {
      return NextResponse.json({ ok: true, bound: false, code, expiresAt: expiresAt.toISOString() })
    }
    lastErr = error
  }

  console.error('create binding code failed', lastErr)
  return NextResponse.json({ ok: false, error: 'create_binding_code_failed' }, { status: 500 })
}

