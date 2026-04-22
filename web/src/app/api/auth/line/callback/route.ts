import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { createClient } from '@/lib/supabase/server'

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
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/')) return '/dashboard'
  if (raw.startsWith('//')) return '/dashboard'
  if (raw.includes('\\')) return '/dashboard'
  return raw
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
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=${encodeURIComponent(error)}`)
  }
  if (!code || !state || !ctx?.state || state !== ctx.state) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=invalid_state`)
  }

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=service_role_not_configured`)
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
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=missing_login_channel`)
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
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=token_exchange_failed`)
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
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=missing_sub`)
  }
  if (ctx?.nonce && nonce && ctx.nonce !== nonce) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=nonce_mismatch`)
  }

  // 1) 先看是否已綁定（players.line_user_id -> auth_user_id）
  const { data: existingBind } = await admin
    .from('players')
    .select('auth_user_id')
    .eq('line_user_id', sub)
    .maybeSingle()

  let authUserId: string | null =
    existingBind && typeof existingBind.auth_user_id === 'string' ? existingBind.auth_user_id : null

  // 2) 若尚未綁定，建立/取得一個 Supabase Auth user
  let loginEmail = email.trim()
  if (!loginEmail) {
    // LINE 沒回 email 時，使用合成 email（不影響 LINE 登入；僅用於 Supabase Auth 帳號鍵）
    loginEmail = `line+${sub}@example.com`
  }

  if (!authUserId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      email_confirm: true,
      user_metadata: {
        display_name: nameFromIdToken || '球友',
        line_sub: sub,
      },
    })

    if (createErr) {
      // 若 email 已存在，嘗試用 metadata 綁定會很難（admin api 無提供依 email 查 user）；
      // 此時引導使用者先用既有方式登入一次再綁定，或改用不同 email scope 設定。
      return NextResponse.redirect(`${origin}/login?error=line_user_create_failed&returnTo=${encodeURIComponent(returnTo)}`)
    }
    authUserId = created.user?.id || null
  }

  if (!authUserId) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=missing_auth_user`)
  }

  // 3) 確保 players 存在並綁定 line_user_id
  const { data: existingPlayer } = await admin
    .from('players')
    .select('id, line_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (!existingPlayer) {
    const codeNoDash = String(authUserId).replace(/-/g, '')
    const playerCode = `u${codeNoDash}`
    const fallbackCode = `u${crypto.randomUUID().replace(/-/g, '')}`

    const displayName = nameFromIdToken.trim() || (loginEmail.includes('@') ? loginEmail.split('@')[0] : '球友')

    const { error: insErr } = await admin.from('players').insert({
      auth_user_id: authUserId,
      player_code: playerCode,
      display_name: displayName,
      line_user_id: sub,
    })
    if (insErr) {
      await admin.from('players').insert({
        auth_user_id: authUserId,
        player_code: fallbackCode,
        display_name: displayName,
        line_user_id: sub,
      })
    }
  } else if (!existingPlayer.line_user_id) {
    await admin.from('players').update({ line_user_id: sub }).eq('auth_user_id', authUserId)
  }

  // 4) 產生一個不寄信的 magiclink，並在伺服端 verify 取得 session，寫入 httpOnly cookies
  const supabase = await createClient()
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: loginEmail,
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
    },
  })

  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.redirect(`${origin}/login?error=line_generate_link_failed&returnTo=${encodeURIComponent(returnTo)}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hashedToken = (linkData.properties as any).hashed_token as string
  const verifyRes = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
    email: loginEmail,
  })

  if (verifyRes.error) {
    return NextResponse.redirect(`${origin}/login?error=line_verify_session_failed&returnTo=${encodeURIComponent(returnTo)}`)
  }

  return NextResponse.redirect(`${origin}${returnTo}?line=ok`)
}

