import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isValidReferralCodeFormat, normalizeReferralCodeInput } from '@/lib/referralCode'
import { insertPublicSignupErrorLog } from '@/lib/publicSignupErrorLog'
import { sanitizeInternalReturnPath } from '@/lib/safeInternalReturnPath'
import { profileLoginBlock } from '@/lib/auth/authPolicy'
import {
  checkLineIdToken,
  decideLineIdentity,
  decodeJwtPayload,
  LINE_OAUTH_COOKIE,
  lineOAuthCookieOptions,
  parseLineOAuthCookie,
  syntheticLineEmail,
  timingSafeEqualStr,
} from '@/lib/auth/lineOAuth'

export const runtime = 'nodejs'

type Admin = NonNullable<ReturnType<typeof createServiceRoleClient>>

/**
 * LINE Login callback。
 * 安全要點：
 *   - state（Cookie 對照、定時比較）、nonce（必須存在且一致）、id_token iss / aud / exp 檢查。
 *   - 身分只用 LINE sub 對應：players.line_user_id，或「由這個 LINE 身分建立」的 Auth 帳號。
 *     LINE email 與另一個（Email 註冊）帳號相同時「不自動合併」，請會員改用原帳號登入後綁定。
 *   - 停權 / 已刪除帳號拒絕登入；不會因 LINE 登入重新授予已撤銷的角色（只在完全沒有 profile 時建立 player）。
 *   - 登入用的 magic link 以「該 Auth 帳號自己的 email」產生（原本用 LINE email：用綁定碼綁過、
 *     email 不同的會員會被導到錯誤帳號或被重複建立帳號）。
 *   - 不記錄 / 不回傳 LINE access token、id_token、Channel Secret；錯誤只帶代碼。
 *   - 失敗紀錄一律 await：Cloudflare Workers 在回應送出後會中止未等待的 Promise（void 會遺失紀錄）。
 */
function loginRedirect(origin: string, returnTo: string, reason: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}&returnTo=${encodeURIComponent(returnTo)}`)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function logFailure(
  admin: ReturnType<typeof createServiceRoleClient>,
  input: { error_code: string; error_message: string; error_detail?: Record<string, unknown>; payload_snapshot?: Record<string, unknown> },
) {
  if (!admin) return
  const ins = await insertPublicSignupErrorLog(admin, {
    flow: 'line_callback',
    error_code: input.error_code,
    error_message: input.error_message,
    error_detail: input.error_detail ?? {},
    payload_snapshot: input.payload_snapshot ?? {},
  })
  if (!ins.ok) console.warn('[line_callback] log insert failed')
}

/**
 * 以 email 找既有 Auth 帳號。只在 createUser 回報 email 已存在後呼叫：
 * 對既有帳號 generateLink 只產生連結（不寄信）並回傳 user 物件（auth schema 不經 PostgREST 開放，不能直接查）。
 */
async function findExistingAuthUserByEmail(admin: Admin, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.user) return null
  return data.user
}

export async function GET(req: Request) {
  const res = await handle(req)
  // 暫存 Cookie 一次性：不論成功失敗都清除（重新整理 callback 不能重放）
  res.cookies.set(LINE_OAUTH_COOKIE, '', { ...lineOAuthCookieOptions(req.url), maxAge: 0 })
  return res
}

function isEmailExistsError(err: { code?: string; status?: number; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === 'email_exists' || err.code === 'user_already_exists' || err.status === 422 || /already/i.test(err.message || '')
}

async function handle(req: Request): Promise<NextResponse> {
  const url = new URL(req.url)
  const origin = url.origin
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const lineError = url.searchParams.get('error')

  const cookieStore = await cookies()
  const ctx = parseLineOAuthCookie(cookieStore.get(LINE_OAUTH_COOKIE)?.value)

  const returnTo = sanitizeInternalReturnPath(ctx?.returnTo, '/dashboard')
  const admin = createServiceRoleClient()

  if (lineError) {
    const cancelled = lineError === 'access_denied'
    await logFailure(admin, {
      error_code: cancelled ? 'LINE_OAUTH_USER_DENIED' : 'LINE_OAUTH_ERROR',
      error_message: lineError.slice(0, 80),
      payload_snapshot: { returnTo },
    })
    return loginRedirect(origin, returnTo, cancelled ? 'line_oauth_cancelled' : `line_oauth_error:${lineError.slice(0, 40)}`)
  }
  if (!ctx) {
    await logFailure(admin, {
      error_code: 'LINE_OAUTH_STATE_MISSING',
      error_message: 'kb_line_oauth cookie missing, expired or unparsable',
      payload_snapshot: { returnTo, code_present: Boolean(code), state_qp_present: Boolean(state) },
    })
    return loginRedirect(origin, returnTo, 'line_oauth_state_missing')
  }
  if (!code) return loginRedirect(origin, returnTo, 'line_oauth_code_missing')
  if (!state || !timingSafeEqualStr(state, ctx.state as string)) {
    await logFailure(admin, { error_code: 'LINE_OAUTH_STATE_MISMATCH', error_message: 'state mismatch', payload_snapshot: { returnTo } })
    return loginRedirect(origin, returnTo, 'line_oauth_state_mismatch')
  }
  if (!admin) return loginRedirect(origin, returnTo, 'service_role_not_configured')

  try {
    const { data: cfg } = await admin
      .from('platform_line_integration')
      .select('login_channel_id, login_channel_secret')
      .eq('id', 1)
      .maybeSingle()
    const c = (cfg || {}) as { login_channel_id?: unknown; login_channel_secret?: unknown }
    const clientId = typeof c.login_channel_id === 'string' ? c.login_channel_id.trim() : ''
    const clientSecret = typeof c.login_channel_secret === 'string' ? c.login_channel_secret.trim() : ''
    if (!clientId || !clientSecret) {
      await logFailure(admin, { error_code: 'LINE_LOGIN_CHANNEL_MISSING', error_message: 'missing_login_channel', payload_snapshot: { returnTo } })
      return loginRedirect(origin, returnTo, 'missing_login_channel')
    }

    // redirect_uri 必須與 start 時相同（同一個 origin）
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${origin}/api/auth/line/callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const tokenJson = (await tokenRes.json().catch(() => null)) as { id_token?: string; error?: string } | null
    if (!tokenRes.ok || !tokenJson?.id_token) {
      // 只記錄 LINE 的錯誤代碼（例如 invalid_grant：code 過期 / 已用過 / redirect_uri 不符），不記錄任何 token
      await logFailure(admin, {
        error_code: 'LINE_OAUTH_TOKEN_EXCHANGE_FAILED',
        error_message: (tokenJson?.error || `http_${tokenRes.status}`).slice(0, 80),
        error_detail: { status: tokenRes.status },
        payload_snapshot: { returnTo },
      })
      return loginRedirect(origin, returnTo, 'token_exchange_failed')
    }

    const idCheck = checkLineIdToken(decodeJwtPayload(tokenJson.id_token), { clientId, nonce: ctx.nonce as string })
    if (!idCheck.ok) {
      await logFailure(admin, { error_code: 'LINE_ID_TOKEN_INVALID', error_message: idCheck.reason, payload_snapshot: { returnTo } })
      return loginRedirect(origin, returnTo, idCheck.reason === 'nonce_mismatch' ? 'nonce_mismatch' : 'line_id_token_invalid')
    }
    const { sub, name } = idCheck
    const emailKey = (idCheck.email || syntheticLineEmail(sub)).toLowerCase()

    // 1) 既有綁定：players.line_user_id = sub
    const { data: bind } = await admin.from('players').select('auth_user_id').eq('line_user_id', sub).maybeSingle()
    let authUserId: string | null = bind && typeof bind.auth_user_id === 'string' ? bind.auth_user_id : null
    let createdNow = false

    // 2) 沒有綁定：建立新帳號；email 已存在時，只有「由這個 LINE 身分建立」的帳號可沿用，其餘拒絕（不自動合併）
    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailKey,
        email_confirm: true,
        app_metadata: { line_sub: sub },
        user_metadata: { display_name: name || '球友', line_sub: sub },
      })
      if (!createErr && created?.user) {
        authUserId = created.user.id
        createdNow = true
      } else {
        const existing = isEmailExistsError(createErr) ? await findExistingAuthUserByEmail(admin, emailKey) : null
        const decision = decideLineIdentity({ sub, boundAuthUserId: null, existingUserWithEmail: existing })
        if (decision.action === 'use') {
          authUserId = decision.authUserId
        } else {
          const reason = decision.action === 'refuse' ? decision.reason : 'missing_auth_user'
          await logFailure(admin, {
            error_code: decision.action === 'refuse' ? 'LINE_EMAIL_LINKED_TO_OTHER_ACCOUNT' : 'LINE_USER_CREATE_FAILED',
            error_message: decision.action === 'refuse' ? reason : (createErr?.code || 'create_failed').slice(0, 40),
            payload_snapshot: { returnTo },
          })
          return loginRedirect(origin, returnTo, reason)
        }
      }
    }

    // 3) 實際登入的 Auth 帳號：取它自己的 email；Auth 已停權則拒絕
    const { data: authUserRes, error: authUserErr } = await admin.auth.admin.getUserById(authUserId as string)
    const authUser = authUserRes?.user
    if (authUserErr || !authUser?.email) {
      await logFailure(admin, { error_code: 'LINE_CALLBACK_UNKNOWN_ERROR', error_message: 'auth_user_unavailable', payload_snapshot: { returnTo } })
      return loginRedirect(origin, returnTo, 'missing_auth_user')
    }
    const bannedUntil = (authUser as { banned_until?: string | null }).banned_until
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) return loginRedirect(origin, returnTo, 'account_suspended')

    // 4) profile：停權 / 刪除則拒絕；只有「完全沒有 profile」時才建立 player（不重新授予已撤銷的角色）
    const { data: existingProfile } = await admin
      .from('app_user_profiles')
      .select('id, primary_role, is_active, is_deleted')
      .eq('id', authUserId)
      .maybeSingle()
    const block = profileLoginBlock(existingProfile as { is_active?: boolean | null; is_deleted?: boolean | null } | null)
    if (block) return loginRedirect(origin, returnTo, block)

    const displayName = (name || '').trim().slice(0, 50) || '球友'
    const hadAppProfileBefore = Boolean(existingProfile)
    if (!existingProfile) {
      await admin
        .from('app_user_profiles')
        .upsert({ id: authUserId, display_name: displayName, primary_role: 'player' }, { onConflict: 'id', ignoreDuplicates: true })
      await admin
        .from('user_role_memberships')
        .upsert({ user_id: authUserId, role: 'player', is_active: true }, { onConflict: 'user_id,role', ignoreDuplicates: true })
    } else if (existingProfile.primary_role === 'player') {
      // 只補「不存在」的 player membership；已存在（含被停用）的不動
      await admin
        .from('user_role_memberships')
        .upsert({ user_id: authUserId, role: 'player', is_active: true }, { onConflict: 'user_id,role', ignoreDuplicates: true })
    }

    const { error: refProfErr } = await admin.rpc('ensure_member_referral_profile', { p_user_id: authUserId })
    if (refProfErr) {
      await logFailure(admin, {
        error_code: 'LINE_CALLBACK_UNKNOWN_ERROR',
        error_message: (refProfErr.code || 'rpc_error').slice(0, 40),
        error_detail: { rpc: 'ensure_member_referral_profile' },
        payload_snapshot: { returnTo },
      })
      return loginRedirect(origin, returnTo, 'referral_profile_failed:rpc')
    }

    const pendingRef = typeof ctx.referralCode === 'string' ? normalizeReferralCodeInput(ctx.referralCode) : ''
    if ((createdNow || !hadAppProfileBefore) && pendingRef && isValidReferralCodeFormat(pendingRef)) {
      const { error: linkErr } = await admin.rpc('member_referral_try_link_after_signup', {
        p_referred_user_id: authUserId,
        p_referral_code: pendingRef,
      })
      // 無效推薦碼不阻擋登入
      if (linkErr) console.warn('[line_callback] referral link skipped')
    }

    // 5) players：確保存在並綁定 line_user_id（不覆寫已綁定其他 LINE 的資料）
    const { data: existingPlayer } = await admin
      .from('players')
      .select('id, line_user_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (!existingPlayer) {
      const { error: insErr } = await admin.from('players').insert({
        auth_user_id: authUserId,
        player_code: `u${String(authUserId).replace(/-/g, '')}`,
        display_name: displayName,
        line_user_id: sub,
      })
      if (insErr) {
        // player_code 撞號時換一組；auth_user_id / line_user_id 唯一鍵衝突（重複點擊）則不再插入
        const { data: nowPlayer } = await admin.from('players').select('id').eq('auth_user_id', authUserId).maybeSingle()
        if (!nowPlayer) {
          await admin.from('players').insert({
            auth_user_id: authUserId,
            player_code: `u${crypto.randomUUID().replace(/-/g, '')}`,
            display_name: displayName,
            line_user_id: sub,
          })
        }
      }
    } else if (!existingPlayer.line_user_id) {
      await admin.from('players').update({ line_user_id: sub }).eq('id', existingPlayer.id).is('line_user_id', null)
    }

    // 6) 以「該帳號自己的 email」產生 magic link（不寄信），瀏覽器走 action_link 回 /auth/callback 建立 session。
    //    redirectTo 必須在 Supabase Redirect URLs 內，否則 Supabase 會改導到 Site URL。
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: authUser.email,
      options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}` },
    })
    const actionLink = typeof linkData?.properties?.action_link === 'string' ? linkData.properties.action_link.trim() : ''
    if (linkErr || !actionLink) {
      await logFailure(admin, {
        error_code: 'LINE_GENERATE_LINK_FAILED',
        error_message: (linkErr?.code || 'no_action_link').slice(0, 40),
        payload_snapshot: { returnTo },
      })
      return loginRedirect(origin, returnTo, 'line_generate_link_failed')
    }
    const res = NextResponse.redirect(actionLink)
    res.headers.set('Cache-Control', 'no-store')
    res.headers.set('Referrer-Policy', 'no-referrer')
    return res
  } catch (e: unknown) {
    console.error('[line_callback] unhandled', e instanceof Error ? e.name : 'error')
    await logFailure(admin, {
      error_code: 'LINE_CALLBACK_UNKNOWN_ERROR',
      error_message: e instanceof Error ? e.name : 'error',
      payload_snapshot: { returnTo },
    })
    return loginRedirect(origin, returnTo, 'line_callback_exception')
  }
}
