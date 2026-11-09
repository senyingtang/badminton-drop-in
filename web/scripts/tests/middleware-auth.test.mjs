// M5：middleware 行為測試（模擬 Supabase 回應；不連任何真實服務）。
// 用真正的 ES256 簽章 JWT + JWKS，驗證 getClaims 本地驗章、Auth 逾時不清 session、停權登出、角色導向、returnTo。
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://testref.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
delete process.env.NEXT_PUBLIC_DEMO_PREVIEW
delete process.env.NEXT_PUBLIC_READONLY_PREVIEW

const { NextRequest } = await import('next/server')
const { middleware } = await import('../../src/middleware.ts')

const results = []
const ok = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'} middleware: ${name}${detail && !pass ? ' — ' + detail : ''}`)
}

// ---------- 金鑰與 token ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const otherPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pubJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'kid-good', alg: 'ES256', use: 'sig', key_ops: ['verify'] }

async function signJwt(payload, { kid = 'kid-good', key = keyPair.privateKey } = {}) {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
  const p = b64u(JSON.stringify(payload))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${h}.${p}`))
  return `${h}.${p}.${b64u(sig)}`
}

const now = Math.floor(Date.now() / 1000)
const USER = '11111111-1111-4111-8111-111111111111'
async function sessionCookie({ exp = now + 3600, kid, key, sub = USER } = {}) {
  const access_token = await signJwt({ sub, aud: 'authenticated', role: 'authenticated', exp, iat: now - 10, session_id: 's1' }, { kid, key })
  const session = { access_token, refresh_token: 'rt-1', expires_at: exp, expires_in: exp - now, token_type: 'bearer', user: { id: sub, aud: 'authenticated' } }
  return `sb-testref-auth-token=base64-${b64u(JSON.stringify(session))}`
}

// ---------- 模擬 fetch ----------
let mode = {}
const calls = []
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  calls.push(`${(init.method || 'GET').toUpperCase()} ${url.pathname}${url.search}`)
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  if (url.pathname === '/auth/v1/.well-known/jwks.json') {
    if (mode.jwks === 'down') throw new TypeError('fetch failed')
    return json(200, { keys: [pubJwk] })
  }
  if (url.pathname === '/auth/v1/token') {
    if (mode.refresh === 'down') throw new TypeError('fetch failed')
    if (mode.refresh === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    if (mode.refresh === 'revoked') return json(400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' })
    const exp = now + 3600
    const access_token = await signJwt({ sub: USER, aud: 'authenticated', role: 'authenticated', exp, iat: now, session_id: 's1' })
    return json(200, { access_token, refresh_token: 'rt-2', expires_in: 3600, expires_at: exp, token_type: 'bearer', user: { id: USER, aud: 'authenticated' } })
  }
  if (url.pathname === '/auth/v1/user') {
    return mode.user === 'down' ? Promise.reject(new TypeError('fetch failed')) : json(200, { id: USER, aud: 'authenticated' })
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 })
  if (url.pathname === '/rest/v1/app_user_profiles') {
    if (mode.profile === 'down') throw new TypeError('fetch failed')
    const row = { primary_role: 'player', is_active: true, is_deleted: false, ...(mode.profileRow || {}) }
    const accept = new Headers(init.headers || {}).get('accept') || ''
    return accept.includes('vnd.pgrst.object') ? json(200, row) : json(200, [row])
  }
  return json(404, { message: 'unexpected ' + url.pathname })
}

async function run(path, cookie, m = {}) {
  mode = m
  calls.length = 0
  const headers = cookie ? { cookie } : {}
  const res = await middleware(new NextRequest(`https://app.example.workers.dev${path}`, { headers }))
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  return { status: res.status, location: res.headers.get('location'), setCookies, calls: [...calls] }
}
const clears = (r) => r.setCookies.some((c) => /^sb-testref-auth-token(\.\d+)?=;/.test(c) || /sb-testref-auth-token[^;]*;.*Max-Age=0/i.test(c))

// 1. 未登入
let r = await run('/member-dashboard?tab=1', null)
ok('未登入進受保護頁 → /login?returnTo=原頁', r.status === 307 && r.location?.includes('/login?returnTo=%2Fmember-dashboard%3Ftab%3D1'), `${r.status} ${r.location}`)
r = await run('/s/ABCD', null)
ok('未登入公開頁直接顯示', r.status === 200 && !r.location)

// 2. 已登入、本地驗章（不打 /auth/v1/user）
const good = await sessionCookie()
r = await run('/member-dashboard', good)
ok('有效 session → 放行', r.status === 200 && !r.location, `${r.status} ${r.location}`)
ok('不呼叫 /auth/v1/user（本地 ES256 驗章）', !r.calls.some((c) => c.includes('/auth/v1/user')), r.calls.join(' | '))
r = await run('/member-dashboard', good)
ok('第二個請求 JWKS 走快取', !r.calls.some((c) => c.includes('jwks')), r.calls.join(' | '))

// 3. 角色導向
r = await run('/dashboard', good, { profileRow: { primary_role: 'player' } })
ok('player 進 /dashboard → /member-dashboard', r.location?.endsWith('/member-dashboard'), r.location)
r = await run('/dashboard', good, { profileRow: { primary_role: 'host' } })
ok('host 進 /dashboard → 放行（不被誤導到會員中心）', r.status === 200 && !r.location, `${r.status} ${r.location}`)
r = await run('/sessions', good, { profileRow: { primary_role: 'venue_owner' } })
ok('venue_owner 進 /sessions → 放行', r.status === 200 && !r.location)
r = await run('/login', good, { profileRow: { primary_role: 'platform_admin' } })
ok('已登入 admin 開 /login → /dashboard', r.location?.endsWith('/dashboard'), r.location)
r = await run('/login', good, { profileRow: { primary_role: 'player' } })
ok('已登入 player 開 /login → /member-dashboard', r.location?.endsWith('/member-dashboard'), r.location)
r = await run('/register?returnTo=%2Fs%2FAB12', good)
ok('已登入開 /register?returnTo=/s/AB12 → /s/AB12', r.location === 'https://app.example.workers.dev/s/AB12', r.location)
r = await run('/login?returnTo=https%3A%2F%2Fevil.com', good)
ok('returnTo 外部網址被忽略（無 open redirect）', r.location?.startsWith('https://app.example.workers.dev/'), r.location)
r = await run('/login?returnTo=%2Flogin', good)
ok('returnTo=/login 不造成迴圈', r.location?.endsWith('/member-dashboard'), r.location)

// 4. 停權 / 刪除
r = await run('/member-dashboard', good, { profileRow: { is_active: false } })
ok('停權 → /login?reason=account_suspended', r.location?.endsWith('/login?reason=account_suspended'), r.location)
ok('停權 → 清除 session cookie', clears(r), r.setCookies.join(' | '))
ok('停權 → 呼叫 logout', r.calls.some((c) => c.startsWith('POST /auth/v1/logout')), r.calls.join(' | '))
r = await run('/dashboard', good, { profileRow: { primary_role: 'host', is_deleted: true } })
ok('已刪除 host → /login?reason=account_deleted', r.location?.endsWith('/login?reason=account_deleted'), r.location)

// 5. Auth 暫時故障：不得清除有效 session
const nearExpiry = await sessionCookie({ exp: now + 20 })
r = await run('/member-dashboard', nearExpiry, { refresh: 'down' })
ok('refresh 網路失敗 → 503（不導去 /login）', r.status === 503 && !r.location, `${r.status} ${r.location}`)
ok('refresh 網路失敗 → 不清除 cookie', !clears(r) && r.setCookies.length === 0, r.setCookies.join(' | '))
r = await run('/member-dashboard', nearExpiry, { refresh: 'timeout' })
ok('refresh 逾時 → 503、不清 cookie', r.status === 503 && r.setCookies.length === 0, `${r.status} ${r.setCookies.join('|')}`)
r = await run('/s/ABCD', nearExpiry, { refresh: 'down' })
ok('Auth 故障時公開頁照常顯示', r.status === 200 && r.setCookies.length === 0)
const otherKid = await sessionCookie({ kid: 'kid-new' })
r = await run('/member-dashboard', otherKid, { jwks: 'down' })
ok('JWKS 取不到 → 503、不清 cookie', r.status === 503 && r.setCookies.length === 0, `${r.status} ${r.setCookies.join('|')}`)

// 6. 自動刷新：Set-Cookie 寫回（導向時也保留）
r = await run('/member-dashboard', nearExpiry)
ok('快到期 → 自動 refresh 並寫回新 cookie', r.status === 200 && r.setCookies.some((c) => c.startsWith('sb-testref-auth-token=') && !/Max-Age=0/i.test(c)), r.setCookies.join(' | '))
ok('刷新後的 session cookie 帶 Secure + SameSite=Lax', r.setCookies.filter((c) => c.startsWith('sb-testref-auth-token=')).every((c) => /;\s*Secure/i.test(c) && /SameSite=Lax/i.test(c)), r.setCookies.join(' | '))
r = await run('/dashboard', nearExpiry, { profileRow: { primary_role: 'player' } })
ok('refresh + 導向 → 新 cookie 一併帶上', r.location?.endsWith('/member-dashboard') && r.setCookies.some((c) => c.startsWith('sb-testref-auth-token=') && !/Max-Age=0/i.test(c)), r.setCookies.join(' | '))

// 7. 真的失效：refresh token 已撤銷 / 簽章錯誤 → 視為未登入
const expired = await sessionCookie({ exp: now - 100 })
r = await run('/member-dashboard', expired, { refresh: 'revoked' })
ok('refresh token 已撤銷（登出後）→ /login', r.location?.includes('/login?returnTo='), `${r.status} ${r.location}`)
ok('refresh token 已撤銷 → 清除 cookie', clears(r), r.setCookies.join(' | '))
const forged = await sessionCookie({ key: otherPair.privateKey })
r = await run('/dashboard', forged, { profileRow: { primary_role: 'platform_admin' } })
ok('偽造簽章 → 視為未登入（不查角色、不放行管理頁）', r.location?.includes('/login?returnTo=') && !r.calls.some((c) => c.includes('app_user_profiles')), `${r.location} ${r.calls.join('|')}`)

// 8. 角色查詢失敗
r = await run('/dashboard', good, { profile: 'down' })
ok('角色查詢失敗 → 管理頁 503', r.status === 503)
r = await run('/member-dashboard', good, { profile: 'down' })
ok('角色查詢失敗 → 會員頁照常（資料層由 RLS 把關）', r.status === 200)


// 9. Supabase 回跳落在根路徑 → /auth/confirm（保留 query）
r = await run('/?code=abc123', null)
ok('/?code= → /auth/confirm?code=', r.location === 'https://app.example.workers.dev/auth/confirm?code=abc123', r.location)
r = await run('/?token_hash=th&type=email', null)
ok('/?token_hash= → /auth/confirm', r.location === 'https://app.example.workers.dev/auth/confirm?token_hash=th&type=email', r.location)
ok('根路徑轉交不呼叫 Supabase', r.calls.length === 0, r.calls.join('|'))

const failed = results.filter((x) => !x).length
console.log(`\nmiddleware-auth: ${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
