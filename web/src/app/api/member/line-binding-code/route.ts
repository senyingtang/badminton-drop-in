import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function randomCode(len = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // avoid 0/O/1/I; always uppercase
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

async function ensurePlayer(admin: NonNullable<ReturnType<typeof createServiceRoleClient>>, userId: string, email?: string | null) {
  const { data: existing } = await admin.from('players').select('id, line_oa_user_id, line_user_id').eq('auth_user_id', userId).maybeSingle()
  if (existing?.id) return { player: existing, created: false }

  const codeNoDash = String(userId).replace(/-/g, '')
  const playerCode = `u${codeNoDash}`
  const fallbackCode = `u${crypto.randomUUID().replace(/-/g, '')}`
  const displayName = (typeof email === 'string' ? email.split('@')[0] : '') || '球友'

  const { data: ins, error: insErr } = await admin
    .from('players')
    .insert({ auth_user_id: userId, player_code: playerCode, display_name: displayName })
    .select('id, line_oa_user_id, line_user_id')
    .maybeSingle()
  if (!insErr && ins?.id) return { player: ins, created: true }

  const { data: ins2, error: ins2Err } = await admin
    .from('players')
    .insert({ auth_user_id: userId, player_code: fallbackCode, display_name: displayName })
    .select('id, line_oa_user_id, line_user_id')
    .maybeSingle()
  if (ins2Err || !ins2?.id) throw new Error('CREATE_PLAYER_FAILED')
  return { player: ins2, created: true }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(503, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const { data: oaData } = await admin.from('platform_line_integration').select('oa_add_friend_url').eq('id', 1).maybeSingle()
  const oaAddFriendUrl = typeof (oaData as any)?.oa_add_friend_url === 'string' ? (oaData as any).oa_add_friend_url.trim() : ''
  if (!oaAddFriendUrl) return json(503, { ok: false, error: 'LINE_OA_NOT_CONFIGURED' })

  const { player } = await ensurePlayer(admin, user.id, user.email)
  const boundLineOaUserId = (player as any)?.line_oa_user_id || (player as any)?.line_user_id || null
  if (boundLineOaUserId) {
    return json(200, {
      ok: true,
      bound: true,
      lineOaUserId: boundLineOaUserId,
      line_oa_add_friend_url: oaAddFriendUrl,
    })
  }

  // Return latest pending code if exists
  const { data: bc } = await admin
    .from('line_oa_binding_codes')
    .select('code, expires_at, status')
    .eq('user_id', user.id)
    .in('status', ['pending'])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (bc?.code) {
    return json(200, {
      ok: true,
      bound: false,
      code: String((bc as any).code),
      expires_at: String((bc as any).expires_at),
      line_oa_add_friend_url: oaAddFriendUrl,
    })
  }

  return json(200, {
    ok: true,
    bound: false,
    code: null,
    expires_at: null,
    line_oa_add_friend_url: oaAddFriendUrl,
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) return json(401, { ok: false, error: 'UNAUTHENTICATED' })

  const admin = createServiceRoleClient()
  if (!admin) return json(503, { ok: false, error: 'SERVICE_ROLE_NOT_CONFIGURED' })

  const note = String(((await req.json().catch(() => null)) as any)?.note || '')

  const { data: oaData } = await admin.from('platform_line_integration').select('oa_add_friend_url').eq('id', 1).maybeSingle()
  const oaAddFriendUrl = typeof (oaData as any)?.oa_add_friend_url === 'string' ? (oaData as any).oa_add_friend_url.trim() : ''
  if (!oaAddFriendUrl) return json(503, { ok: false, error: 'LINE_OA_NOT_CONFIGURED' })

  let playerId: string | null = null
  try {
    const { player } = await ensurePlayer(admin, user.id, user.email)
    playerId = (player as any)?.id ? String((player as any).id) : null
    const boundLineOaUserId = (player as any)?.line_oa_user_id || (player as any)?.line_user_id || null
    if (boundLineOaUserId) {
      return json(200, { ok: true, bound: true, lineOaUserId: boundLineOaUserId, line_oa_add_friend_url: oaAddFriendUrl })
    }
  } catch {
    return json(404, { ok: false, error: 'PROFILE_NOT_FOUND' })
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  // Expire old pending codes
  await admin
    .from('line_oa_binding_codes')
    .update({ status: 'expired' })
    .eq('user_id', user.id)
    .eq('status', 'pending')

  let lastErr: unknown = null
  for (let i = 0; i < 6; i++) {
    const code = randomCode(6)
    const { error } = await admin.from('line_oa_binding_codes').insert({
      id: crypto.randomUUID(),
      user_id: user.id,
      player_id: playerId,
      code,
      status: 'pending',
      expires_at: expiresAt,
      metadata: { note, actor_user_id: user.id },
    })

    if (!error) {
      return json(200, {
        ok: true,
        bound: false,
        code,
        expires_at: expiresAt,
        line_oa_add_friend_url: oaAddFriendUrl,
        instructions: {
          title: 'LINE@ 通知綁定',
          command: `綁定 ${code}`,
          expires_in_minutes: 10,
        },
      })
    }
    lastErr = error
  }

  console.error('create line binding code failed', lastErr)
  return json(500, { ok: false, error: 'CREATE_BINDING_CODE_FAILED' })
}

