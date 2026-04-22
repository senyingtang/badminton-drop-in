import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

function randomString(len = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = url.origin
  const returnTo = url.searchParams.get('returnTo') || '/dashboard'

  const admin = createServiceRoleClient()
  if (!admin) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=service_role_not_configured`)
  }

  const { data: cfg, error: cfgErr } = await admin
    .from('platform_line_integration')
    .select('login_channel_id, login_channel_secret')
    .eq('id', 1)
    .maybeSingle()

  if (cfgErr || !cfg) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=no_line_config`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = cfg as any
  const clientId = typeof c.login_channel_id === 'string' ? c.login_channel_id.trim() : ''
  const clientSecret = typeof c.login_channel_secret === 'string' ? c.login_channel_secret.trim() : ''
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}${returnTo}?line=err&reason=missing_login_channel`)
  }

  const state = randomString(40)
  const nonce = randomString(32)
  const redirectUri = `${origin}/api/auth/line/callback`

  const cookieStore = await cookies()
  cookieStore.set('kb_line_oauth', JSON.stringify({ state, nonce, returnTo, t: Date.now() }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  })

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('prompt', 'consent')

  return NextResponse.redirect(authUrl.toString())
}

