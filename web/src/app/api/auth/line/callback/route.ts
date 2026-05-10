import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'
export const runtime = 'nodejs'

type LineOauthCookie = {
  state?: string
  nonce?: string
  returnTo?: string
  t?: number
  referralCode?: string
}

function safeLoginRedirect(origin: string, returnTo: string, reason: string): NextResponse {
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(reason)}&returnTo=${encodeURIComponent(returnTo)}`
  )
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
    return safeLoginRedirect(origin, returnTo, `line_oauth_error:${error}`)
  }
  if (!code || !state || !ctx?.state || state !== ctx.state) {
    return safeLoginRedirect(origin, returnTo, 'line_invalid_state')
  }

  const admin = createServiceRoleClient()
  if (!admin) {
    return safeLoginRedirect(origin, returnTo, 'service_role_not_configured')
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
    return safeLoginRedirect(origin, returnTo, 'missing_login_channel')
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
    return safeLoginRedirect(origin, returnTo, 'token_exchange_failed')
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
    return safeLoginRedirect(origin, returnTo, 'missing_sub')
  }
  if (ctx?.nonce && nonce && ctx.nonce !== nonce) {
    return safeLoginRedirect(origin, returnTo, 'nonce_mismatch')
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
      // email 已存在：改為重用既有 auth user（service role 可查 auth.users）
      const { data: byEmail } = await admin
        .schema('auth')
        .from('users')
        .select('id')
        .eq('email', loginEmail)
        .maybeSingle()

      authUserId = byEmail?.id ?? null

      if (!authUserId) {
        // 若仍找不到（極少數），再試著用 raw_user_meta_data.line_sub 找既有綁定
        const { data: byMeta } = await admin
          .schema('auth')
          .from('users')
          .select('id')
          .filter('raw_user_meta_data->>line_sub', 'eq', sub)
          .maybeSingle()
        authUserId = byMeta?.id ?? null
      }

      if (!authUserId) {
        return safeLoginRedirect(origin, returnTo, 'line_user_create_failed_email_exists')
      }
    }
    if (!authUserId) authUserId = created.user?.id || null
  }

  if (!authUserId) {
    return safeLoginRedirect(origin, returnTo, 'missing_auth_user')
  }

  // 2.5) 確保 app_user_profiles / user_role_memberships 存在（避免外鍵/權限依賴）
  const displayName = nameFromIdToken.trim() || (loginEmail.includes('@') ? loginEmail.split('@')[0] : '球友')
  const { data: existingProfile } = await admin
    .from('app_user_profiles')
    .select('id, primary_role')
    .eq('id', authUserId)
    .maybeSingle()
  const hadAppProfileBefore = Boolean(existingProfile)
  if (!existingProfile) {
    await admin.from('app_user_profiles').insert({
      id: authUserId,
      display_name: displayName,
      primary_role: 'player',
    })
    await admin.from('user_role_memberships').upsert(
      { user_id: authUserId, role: 'player', is_active: true },
      { onConflict: 'user_id,role' }
    )
  } else if (existingProfile.primary_role === 'player') {
    const { data: playerRow } = await admin
      .from('user_role_memberships')
      .select('id')
      .eq('user_id', authUserId)
      .eq('role', 'player')
      .maybeSingle()
    if (!playerRow) {
      await admin.from('user_role_memberships').upsert(
        { user_id: authUserId, role: 'player', is_active: true },
        { onConflict: 'user_id,role' }
      )
    }
  }

  const { error: refProfErr } = await admin.rpc('ensure_member_referral_profile', { p_user_id: authUserId })
  if (refProfErr) {
    return safeLoginRedirect(origin, returnTo, `referral_profile_failed:${refProfErr.message}`)
  }

  const pendingRef = typeof ctx?.referralCode === 'string' ? normalizeReferralCodeInput(ctx.referralCode) : ''
  if (!hadAppProfileBefore && pendingRef && isValidReferralCodeFormat(pendingRef)) {
    const { error: linkErr } = await admin.rpc('member_referral_try_link_after_signup', {
      p_referred_user_id: authUserId,
      p_referral_code: pendingRef,
    })
    // 無效推薦碼不阻擋登入：帳號已建立，略過推薦關係即可（與 Email 註冊「先驗碼」語意不同）
    if (linkErr) {
      console.error('LINE referral link skipped:', linkErr.message)
    }
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

  // 4) 產生 magiclink（不寄信），改由瀏覽器端走 action_link 完成登入回跳並建立 cookie
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
    return safeLoginRedirect(origin, returnTo, 'line_generate_link_failed')
  }
  return NextResponse.redirect(actionLink)
}

