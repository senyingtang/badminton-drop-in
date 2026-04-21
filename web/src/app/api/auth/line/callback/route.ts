import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

type LineOauthCookie = {
  state?: string
  nonce?: string
  returnTo?: string
  userId?: string
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

  const returnTo = ctx?.returnTo || '/settings'
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

  if (!sub) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=missing_sub`)
  }
  if (ctx?.nonce && nonce && ctx.nonce !== nonce) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=nonce_mismatch`)
  }
  if (!ctx?.userId) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=missing_user`)
  }

  const { data: p, error: pErr } = await admin
    .from('players')
    .update({ line_user_id: sub })
    .eq('auth_user_id', ctx.userId)
    .select('id')
    .maybeSingle()

  if (pErr || !p) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=player_not_found`)
  }

  return NextResponse.redirect(`${origin}${returnTo}?line=ok`)
}

