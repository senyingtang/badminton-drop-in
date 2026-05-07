import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
export const runtime = 'nodejs'

type LineOauthCookie = {
  state?: string
  nonce?: string
  returnTo?: string
  t?: number
}

function base64UrlDecode(input: string): string {
  const pad = '='.repeat((4 - (input.length % 4)) % 4)
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf8')
}

function parseJwtPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
}

function safeReturnTo(input: string | null | undefined): string {
  const raw = (input || '').trim()
  if (!raw) return '/member-dashboard'
  if (!raw.startsWith('/')) return '/member-dashboard'
  if (raw.startsWith('//')) return '/member-dashboard'
  if (raw.includes('\\')) return '/member-dashboard'
  return raw
}

async function findAuthUserIdByEmail(
  admin: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  email: string
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  if (!target) return null

  // Supabase Admin API currently has no direct getUserByEmail helper.
  // This is acceptable for MVP/debug. If user count grows, replace with a SECURITY DEFINER RPC.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users?.length) return null
    const found = data.users.find((u) => (u.email || '').trim().toLowerCase() === target)
    if (found?.id) return found.id
    if (data.users.length < 1000) break
  }
  return null
}

async function ensureAppProfile(
  admin: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  authUserId: string,
  displayName: string
) {
  await admin.from('app_user_profiles').upsert(
    {
      id: authUserId,
      display_name: displayName || '球友',
      primary_role: 'player',
      is_active: true,
    },
    { onConflict: 'id', ignoreDuplicates: false }
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = url.origin
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const cookieStore = await cookies()
  const raw = cookieStore.get('kb_line_oauth')?.value || ''
  cookieStore.set('kb_line_oauth', '', { path: '/', maxAge: 0 })

  let ctx: LineOauthCookie | null = null
  try {
    ctx = raw ? (JSON.parse(raw) as LineOauthCookie) : null
  } catch {
    ctx = null
  }

  const returnTo = safeReturnTo(ctx?.returnTo)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}&returnTo=${encodeURIComponent(returnTo)}`)
  }
  if (!code || !state || !ctx?.state || state !== ctx.state) {
    return NextResponse.redirect(`${origin}/login?error=invalid_line_state&returnTo=${encodeURIComponent(returnTo)}`)
  }

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.redirect(`${origin}/login?error=service_role_not_configured&returnTo=${encodeURIComponent(returnTo)}`)
  }

  const { data: cfg } = await admin
    .from('platform_line_integration')
    .select('login_channel_id, login_channel_secret')
    .eq('id', 1)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (cfg || {}) as any
  const clientId = typeof c.login_channel_id === 'string' ? c.login_channel_id.trim() : ''
  const clientSecret = typeof c.login_channel_secret === 'string' ? c.login_channel_secret.trim() : ''
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/login?error=missing_login_channel&returnTo=${encodeURIComponent(returnTo)}`)
  }

  const redirectUri = `${origin}/api/auth/line/callback`

  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | { id_token?: string; access_token?: string; error?: string; error_description?: string }
    | null

  if (!tokenRes.ok || !tokenJson) {
    return NextResponse.redirect(`${origin}/login?error=token_exchange_failed&returnTo=${encodeURIComponent(returnTo)}`)
  }

  const idToken = typeof tokenJson.id_token === 'string' ? tokenJson.id_token : ''
  const payload = idToken ? parseJwtPayload(idToken) : null
  const sub = payload && typeof payload.sub === 'string' ? payload.sub : ''
  const nonce = payload && typeof payload.nonce === 'string' ? payload.nonce : ''
  const email = payload && typeof payload.email === 'string' ? payload.email : ''
  const nameFromIdToken =
    payload && typeof payload.name === 'string'
      ? payload.name
      : payload && typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : ''

  if (!sub) {
    return NextResponse.redirect(`${origin}/login?error=missing_line_sub&returnTo=${encodeURIComponent(returnTo)}`)
  }
  if (ctx?.nonce && nonce && ctx.nonce !== nonce) {
    return NextResponse.redirect(`${origin}/login?error=nonce_mismatch&returnTo=${encodeURIComponent(returnTo)}`)
  }

  const displayName = nameFromIdToken.trim() || '球友'

  // 1) Already bound by LINE sub.
  const { data: existingBind } = await admin
    .from('players')
    .select('auth_user_id')
    .eq('line_user_id', sub)
    .maybeSingle()

  let authUserId: string | null =
    existingBind && typeof existingBind.auth_user_id === 'string' ? existingBind.auth_user_id : null

  // 2) Determine auth email.
  let loginEmail = email.trim()
  if (!loginEmail) {
    loginEmail = `line+${sub}@example.com`
  }

  // 3) If not bound, reuse existing Supabase user by email before creating a new one.
  if (!authUserId) {
    authUserId = await findAuthUserIdByEmail(admin, loginEmail)
  }

  if (!authUserId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        line_sub: sub,
      },
    })

    if (createErr) {
      // One final retry in case the failure was a duplicate email race.
      authUserId = await findAuthUserIdByEmail(admin, loginEmail)
      if (!authUserId) {
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent(createErr.message || 'line_user_create_failed')}&returnTo=${encodeURIComponent(returnTo)}`
        )
      }
    } else {
      authUserId = created.user?.id || null
    }
  }

  if (!authUserId) {
    return NextResponse.redirect(`${origin}/login?error=missing_auth_user&returnTo=${encodeURIComponent(returnTo)}`)
  }

  await ensureAppProfile(admin, authUserId, displayName)

  // 4) Ensure player row exists and bind line_user_id.
  const { data: existingPlayer } = await admin
    .from('players')
    .select('id, line_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (!existingPlayer) {
    const codeNoDash = String(authUserId).replace(/-/g, '')
    const playerCode = `u${codeNoDash}`
    const fallbackCode = `u${crypto.randomUUID().replace(/-/g, '')}`

    const { error: insErr } = await admin.from('players').insert({
      auth_user_id: authUserId,
      player_code: playerCode,
      display_name: displayName || (loginEmail.includes('@') ? loginEmail.split('@')[0] : '球友'),
      line_user_id: sub,
    })
    if (insErr) {
      await admin.from('players').insert({
        auth_user_id: authUserId,
        player_code: fallbackCode,
        display_name: displayName || (loginEmail.includes('@') ? loginEmail.split('@')[0] : '球友'),
        line_user_id: sub,
      })
    }
  } else if (!existingPlayer.line_user_id) {
    await admin.from('players').update({ line_user_id: sub }).eq('auth_user_id', authUserId)
  }

  // 5) Create a magic link and let /auth/callback set the Supabase browser session.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: loginEmail,
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (linkData?.properties || {}) as any
  const actionLink = typeof props.action_link === 'string' ? props.action_link.trim() : ''

  if (linkErr || !actionLink) {
    return NextResponse.redirect(`${origin}/login?error=line_generate_link_failed&returnTo=${encodeURIComponent(returnTo)}`)
  }
  return NextResponse.redirect(actionLink)
}
