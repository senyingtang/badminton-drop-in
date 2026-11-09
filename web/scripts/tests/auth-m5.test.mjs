// M5 Auth：純函式單元測試（LINE id_token / 身分對應 / returnTo / 密碼規則 / 錯誤對應 / callback 判斷 / 唯讀過濾 JWKS）
import {
  checkLineIdToken,
  decideLineIdentity,
  decodeJwtPayload,
  lineOAuthCookieOptions,
  parseLineOAuthCookie,
  randomToken,
  syntheticLineEmail,
  timingSafeEqualStr,
} from '../../src/lib/auth/lineOAuth.ts'
import {
  authErrorMessageZh,
  classifyAuthError,
  isAuthNetworkError,
  profileLoginBlock,
  validateEmail,
  validatePassword,
} from '../../src/lib/auth/authPolicy.ts'
import { decideAuthCallback } from '../../src/lib/auth/authCallback.ts'
import { authConfirmUrl, isAuthReturnAtRoot, parsePendingAuth } from '../../src/lib/auth/authNext.ts'
import { isSafeInternalReturnPath } from '../../src/lib/safeInternalReturnPath.ts'
import { filterSupabaseRequest } from '../../src/lib/readonly/readonlyPreview.ts'

const results = []
const ok = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'} auth: ${name}${detail && !pass ? ' — ' + detail : ''}`)
}

// ---------- state / nonce / cookie ----------
const toks = new Set(Array.from({ length: 200 }, () => randomToken(32)))
ok('randomToken: 200 個皆不同', toks.size === 200)
ok('randomToken: base64url、長度 43', [...toks].every((t) => /^[A-Za-z0-9_-]{43}$/.test(t)))
const httpsOpt = lineOAuthCookieOptions('https://x.workers.dev/api/auth/line/start')
ok('cookie https: HttpOnly + Secure + Lax + Path=/ + 600s', httpsOpt.httpOnly && httpsOpt.secure && httpsOpt.sameSite === 'lax' && httpsOpt.path === '/' && httpsOpt.maxAge === 600)
ok('cookie http (本機): 不設 Secure', lineOAuthCookieOptions('http://localhost:3000/x').secure === false)
ok('cookie: 不設 Domain（只屬於目前網域）', !('domain' in httpsOpt))
const now = Date.now()
ok('oauth cookie 解析', parseLineOAuthCookie(JSON.stringify({ state: 'a', nonce: 'b', t: now }), now)?.state === 'a')
ok('oauth cookie 逾 10 分鐘失效', parseLineOAuthCookie(JSON.stringify({ state: 'a', nonce: 'b', t: now - 11 * 60 * 1000 }), now) === null)
ok('oauth cookie 缺 nonce 失效', parseLineOAuthCookie(JSON.stringify({ state: 'a' }), now) === null)
ok('oauth cookie 壞 JSON 失效', parseLineOAuthCookie('{oops', now) === null)
ok('timingSafeEqual', timingSafeEqualStr('abc', 'abc') && !timingSafeEqualStr('abc', 'abd') && !timingSafeEqualStr('abc', 'ab'))

// ---------- id_token ----------
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (p) => `${b64u({ alg: 'HS256' })}.${b64u(p)}.sig`
const nowSec = Math.floor(now / 1000)
const good = { iss: 'https://access.line.me', aud: '1650000000', exp: nowSec + 600, nonce: 'N1', sub: 'U123', email: 'a@b.tw', name: '小明' }
const chk = (p, o = {}) => checkLineIdToken(decodeJwtPayload(jwt(p)), { clientId: '1650000000', nonce: 'N1', nowSec, ...o })
const g = chk(good)
ok('id_token 正常', g.ok && g.sub === 'U123' && g.email === 'a@b.tw' && g.name === '小明', JSON.stringify(g))
ok('id_token 中文 name 正確解碼', g.ok && g.name === '小明')
ok('id_token iss 錯誤 → bad_issuer', chk({ ...good, iss: 'https://evil' }).reason === 'bad_issuer')
ok('id_token aud 錯誤 → bad_audience', chk({ ...good, aud: '999' }).reason === 'bad_audience')
ok('id_token 過期 → expired', chk({ ...good, exp: nowSec - 120 }).reason === 'expired')
ok('id_token 缺 nonce → nonce_mismatch（原本會略過）', chk({ ...good, nonce: undefined }).reason === 'nonce_mismatch')
ok('id_token nonce 不同 → nonce_mismatch', chk({ ...good, nonce: 'N2' }).reason === 'nonce_mismatch')
ok('id_token 缺 sub → missing_sub', chk({ ...good, sub: '' }).reason === 'missing_sub')
ok('id_token 壞格式 → invalid_id_token', checkLineIdToken(decodeJwtPayload('nope'), { clientId: 'x', nonce: 'y' }).reason === 'invalid_id_token')
ok('id_token 無 email → email 空字串', chk({ ...good, email: undefined }).email === '')
ok('合成 email 格式沿用舊版', syntheticLineEmail('U1') === 'line+U1@example.com')

// ---------- 身分對應（不自動合併） ----------
ok('已綁定 players.line_user_id → 沿用', decideLineIdentity({ sub: 'U1', boundAuthUserId: 'A', existingUserWithEmail: null }).authUserId === 'A')
ok('無綁定、無同 email 帳號 → create', decideLineIdentity({ sub: 'U1', boundAuthUserId: null, existingUserWithEmail: null }).action === 'create')
ok('同 email、user_metadata.line_sub 相同 → 沿用（綁定遺失時）',
  decideLineIdentity({ sub: 'U1', boundAuthUserId: null, existingUserWithEmail: { id: 'B', user_metadata: { line_sub: 'U1' } } }).authUserId === 'B')
ok('同 email、app_metadata.line_sub 相同 → 沿用',
  decideLineIdentity({ sub: 'U1', boundAuthUserId: null, existingUserWithEmail: { id: 'B', app_metadata: { line_sub: 'U1' } } }).authUserId === 'B')
ok('同 email、Email 註冊帳號（無 line_sub）→ 拒絕，不合併',
  decideLineIdentity({ sub: 'U1', boundAuthUserId: null, existingUserWithEmail: { id: 'C', user_metadata: {} } }).action === 'refuse')
ok('同 email、不同 LINE 的 line_sub → 拒絕',
  decideLineIdentity({ sub: 'U1', boundAuthUserId: null, existingUserWithEmail: { id: 'D', user_metadata: { line_sub: 'U2' } } }).action === 'refuse')

// ---------- returnTo（open redirect） ----------
for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/x?u=https://evil', 'javascript:alert(1)', '/a@evil.com', '', null, 'dashboard', '/\tx'])
  ok(`returnTo 拒絕 ${JSON.stringify(bad)}`, !isSafeInternalReturnPath(bad))
for (const goodPath of ['/dashboard', '/member-dashboard/dropins', '/s/AB12?x=1', '/signup/abc'])
  ok(`returnTo 允許 ${goodPath}`, isSafeInternalReturnPath(goodPath))

// ---------- 密碼 / email ----------
ok('密碼太短', validatePassword('ab12') !== null)
ok('密碼純數字', validatePassword('12345678') !== null)
ok('密碼純字母', validatePassword('abcdefgh') !== null)
ok('密碼合格', validatePassword('abcd1234') === null)
ok('密碼超過 72', validatePassword('a1'.repeat(40)) !== null)
ok('email 格式錯誤', validateEmail('a@b') !== null && validateEmail('ab.com') !== null && validateEmail('') !== null)
ok('email 合格', validateEmail(' user@example.com.tw ') === null)

// ---------- 錯誤對應（不外露原文、不枚舉） ----------
ok('invalid_credentials', classifyAuthError({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }) === 'invalid_credentials')
ok('舊版僅 message', classifyAuthError({ status: 400, message: 'Invalid login credentials' }) === 'invalid_credentials')
ok('email_not_confirmed', classifyAuthError({ code: 'email_not_confirmed', status: 400 }) === 'email_not_confirmed')
ok('rate limit 429', classifyAuthError({ status: 429, message: 'x' }) === 'rate_limited')
ok('over_email_send_rate_limit', classifyAuthError({ code: 'over_email_send_rate_limit', status: 429 }) === 'rate_limited')
ok('otp_expired → link_invalid', classifyAuthError({ code: 'otp_expired', status: 403 }) === 'link_invalid')
ok('weak_password', classifyAuthError({ code: 'weak_password', status: 422 }) === 'weak_password')
ok('same_password', classifyAuthError({ code: 'same_password', status: 422 }) === 'same_password')
ok('網路錯誤 → auth_unavailable', classifyAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }) === 'auth_unavailable')
ok('504 → 網路錯誤', isAuthNetworkError({ status: 504 }))
ok('TimeoutError → 網路錯誤', isAuthNetworkError({ name: 'TimeoutError', message: 'The operation was aborted due to timeout' }))
ok('400 refresh_token_not_found 不是網路錯誤（應登出）', !isAuthNetworkError({ name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }))
ok('中文訊息不含英文原文', !/[A-Za-z]{4,}/.test(authErrorMessageZh('invalid_credentials')))
ok('帳號不存在與密碼錯誤同一訊息', authErrorMessageZh(classifyAuthError({ message: 'Invalid login credentials' })) === '電子郵件或密碼不正確。')
ok('未知代碼 → 通用訊息（不回顯）', authErrorMessageZh('<script>evil</script>') === '操作失敗，請稍後再試。')

// ---------- 停權 / 刪除 ----------
ok('停權', profileLoginBlock({ is_active: false, is_deleted: false }) === 'account_suspended')
ok('已刪除優先', profileLoginBlock({ is_active: false, is_deleted: true }) === 'account_deleted')
ok('正常', profileLoginBlock({ is_active: true, is_deleted: false }) === null)
ok('無 profile（新帳號）不擋', profileLoginBlock(null) === null)
ok('is_active 為 null 不視為停權', profileLoginBlock({ is_active: null }) === null)

// ---------- /auth/callback 判斷 ----------
const base = { type: '', next: '/member-dashboard', providerError: null, attempted: true, success: false, error: null, hasSession: false }
ok('成功 → next', decideAuthCallback({ ...base, success: true }).redirect === '/member-dashboard')
ok('recovery 成功 → /reset-password', decideAuthCallback({ ...base, type: 'recovery', next: '/reset-password', success: true }).redirect === '/reset-password')
ok('otp_expired（signup）→ 登入頁 link_invalid', decideAuthCallback({ ...base, providerError: 'otp_expired' }).redirect.startsWith('/login?error=link_invalid'))
ok('otp_expired（recovery）→ 忘記密碼頁', decideAuthCallback({ ...base, type: 'recovery', next: '/reset-password', providerError: 'otp_expired' }).redirect === '/forgot-password?error=link_invalid')
ok('PKCE 跨裝置（signup）→ 信箱已驗證，請登入',
  decideAuthCallback({ ...base, error: { name: 'AuthPKCECodeVerifierMissingError', message: 'PKCE code verifier not found in storage.' } }).redirect.startsWith('/login?reason=email_confirmed'))
ok('PKCE 跨裝置（recovery）→ 提示同一瀏覽器',
  decideAuthCallback({ ...base, type: 'recovery', next: '/reset-password', error: { name: 'AuthPKCECodeVerifierMissingError' } }).redirect === '/forgot-password?error=other_device')
ok('連結重複點擊但已登入 → next', decideAuthCallback({ ...base, error: { code: 'otp_expired' }, hasSession: true }).redirect === '/member-dashboard')
ok('什麼參數都沒有 → auth_callback_failed', decideAuthCallback({ ...base, attempted: false }).redirect.startsWith('/login?error=auth_callback_failed'))
ok('失敗時保留 returnTo', decideAuthCallback({ ...base, error: { code: 'otp_expired' } }).redirect.includes('returnTo=%2Fmember-dashboard'))

// ---------- 唯讀整合站：getClaims 需要 JWKS ----------
ok('唯讀過濾允許 GET JWKS', filterSupabaseRequest('GET', '/auth/v1/.well-known/jwks.json', '', null).action === 'allow')
ok('唯讀過濾仍拒絕 signup / recover / verify', ['signup', 'recover', 'verify', 'otp'].every((ep) => filterSupabaseRequest('POST', `/auth/v1/${ep}`, '', '{}').action === 'deny'))


// ---------- M6：Email 範本 {{ .RedirectTo }} 相容 ----------
ok('redirectTo = origin/auth/confirm（無 query，可當範本前綴）', authConfirmUrl('https://x.workers.dev/') === 'https://x.workers.dev/auth/confirm')
const tNow = Date.now()
ok('pending signup 解析', parsePendingAuth(JSON.stringify({ kind: 'signup', next: '/s/AB12', t: tNow }), tNow)?.next === '/s/AB12')
ok('pending recovery 解析', parsePendingAuth(JSON.stringify({ kind: 'recovery', next: '/reset-password', t: tNow }), tNow)?.kind === 'recovery')
ok('pending 超過 24 小時失效', parsePendingAuth(JSON.stringify({ kind: 'signup', next: '/x', t: tNow - 25 * 3600e3 }), tNow) === null)
ok('pending 外部網址被拒', parsePendingAuth(JSON.stringify({ kind: 'signup', next: '//evil.com', t: tNow }), tNow) === null)
ok('pending 未知種類被拒', parsePendingAuth(JSON.stringify({ kind: 'admin', next: '/x', t: tNow }), tNow) === null)
ok('根路徑 ?code → 轉交 /auth/confirm', isAuthReturnAtRoot('/', new URLSearchParams('code=abc')))
ok('根路徑 ?token_hash → 轉交', isAuthReturnAtRoot('/', new URLSearchParams('token_hash=x&type=email')))
ok('根路徑 ?error_code → 轉交', isAuthReturnAtRoot('/', new URLSearchParams('error=access_denied&error_code=otp_expired')))
ok('一般頁面 ?code 不轉交（LINE callback 等）', !isAuthReturnAtRoot('/api/auth/line/callback', new URLSearchParams('code=x')) && !isAuthReturnAtRoot('/', new URLSearchParams('tab=1')))
ok('type=email（官方範本）成功 → next', decideAuthCallback({ type: 'email', next: '/s/AB12', providerError: null, attempted: true, success: true, error: null, hasSession: false }).redirect === '/s/AB12')
ok('recovery（code 流程，由本機記錄判斷）自動交換後 → /reset-password',
  decideAuthCallback({ type: 'recovery', next: '/reset-password', providerError: null, attempted: true, success: false, error: { name: 'AuthPKCECodeVerifierMissingError' }, hasSession: true }).redirect === '/reset-password')

const failed = results.filter((x) => !x).length
console.log(`\nauth-m5: ${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
