import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isSafeInternalReturnPath } from '@/lib/safeInternalReturnPath'
import { insertPublicSignupErrorLog } from '@/lib/publicSignupErrorLog'
import { LINE_OAUTH_COOKIE, lineOAuthCookieOptions, randomToken } from '@/lib/auth/lineOAuth'

export const runtime = 'nodejs'

function normalizeOptionalReferralCode(raw: string | null): string | undefined {
  const v = (raw || '').trim().toUpperCase()
  if (!v) return undefined
  if (v.length > 8) return undefined
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{0,8}$/.test(v)) return undefined
  return v.length === 8 ? v : undefined
}

function loginError(origin: string, returnTo: string, code: string) {
  const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(code)}&returnTo=${encodeURIComponent(returnTo)}`)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/**
 * LINE Login 起點。callback 網址一律取「目前請求的網域」（Cloudflare / Vercel / 本機各自獨立），
 * 該網址必須登記在 LINE Developers → LINE Login channel → Callback URL。
 * Channel Secret 只在伺服端讀取（platform_line_integration，service_role），不會出現在前端或網址。
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = url.origin
  let returnTo = url.searchParams.get('returnTo') || '/dashboard'
  if (!isSafeInternalReturnPath(returnTo)) returnTo = '/dashboard'
  returnTo = returnTo.trim()
  const referralCode = normalizeOptionalReferralCode(url.searchParams.get('referralCode'))

  const admin = createServiceRoleClient()
  if (!admin) return loginError(origin, returnTo, 'service_role_not_configured')

  const { data: cfg, error: cfgErr } = await admin
    .from('platform_line_integration')
    .select('login_channel_id, login_channel_secret')
    .eq('id', 1)
    .maybeSingle()

  const c = (cfg || {}) as { login_channel_id?: unknown; login_channel_secret?: unknown }
  const clientId = typeof c.login_channel_id === 'string' ? c.login_channel_id.trim() : ''
  const hasSecret = typeof c.login_channel_secret === 'string' && c.login_channel_secret.trim().length > 0
  if (cfgErr || !clientId || !hasSecret) {
    // Workers 回應送出後會中止未等待的 Promise：失敗紀錄必須 await 才會寫入
    await insertPublicSignupErrorLog(admin, {
      flow: 'line_start',
      error_code: 'LINE_LOGIN_CHANNEL_MISSING',
      error_message: cfgErr ? 'config_query_failed' : 'missing_login_channel',
      error_detail: cfgErr ? { supabase_code: cfgErr.code } : {},
      payload_snapshot: { returnTo },
    }).catch(() => {})
    return loginError(origin, returnTo, 'missing_login_channel')
  }

  const state = randomToken(32)
  const nonce = randomToken(32)
  const redirectUri = `${origin}/api/auth/line/callback`

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('nonce', nonce)

  const res = NextResponse.redirect(authUrl.toString())
  res.headers.set('Cache-Control', 'no-store')
  // 每次開始都覆寫：前一次失敗 / 取消後重試會拿到全新的 state / nonce
  res.cookies.set(
    LINE_OAUTH_COOKIE,
    JSON.stringify({ state, nonce, returnTo, t: Date.now(), ...(referralCode ? { referralCode } : {}) }),
    lineOAuthCookieOptions(req.url),
  )
  return res
}
