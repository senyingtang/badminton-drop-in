// Production Worker pre-cutover gate (src/worker/prodGate.ts): fail closed, Basic Auth -> signed cookie,
// opens only with PROD_SITE_PUBLIC === '1', strips Basic auth before the app, never calls the app when denied.
import { prodGate, isProdGateBuild, PROD_GATE_COOKIE } from '../../src/worker/prodGate.ts'

const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} prod-gate: ${name}${detail && !pass ? ' — ' + detail : ''}`) }

const PASS = 'correct-horse-battery-staple-42'
const URL_ = 'https://badminton-drop-in-prod.example.workers.dev'
let appCalls = []
const app = async (req) => { appCalls.push(req); return new Response('APP', { status: 200, headers: { 'x-app': '1' } }) }
const basic = (pw) => 'Basic ' + btoa(`any:${pw}`)
const run = async (path, { env = { PROD_GATE_PASSWORD: PASS }, headers = {}, method = 'GET', body } = {}) => {
  appCalls = []
  const res = await prodGate(new Request(URL_ + path, { method, headers, body }), env, app)
  return { res, called: appCalls.length, fwd: appCalls[0] }
}

// --- fail closed: no / short password -> 503 everywhere, app never called
for (const [label, env] of [['no secrets', {}], ['short password', { PROD_GATE_PASSWORD: 'short' }], ['non-string password', { PROD_GATE_PASSWORD: 12345678901234567 }],
  ['PROD_SITE_PUBLIC=true (not exactly "1")', { PROD_SITE_PUBLIC: 'true' }], ['PROD_SITE_PUBLIC=" 1"', { PROD_SITE_PUBLIC: ' 1' }]]) {
  for (const p of ['/', '/api/admin/users/bulk-update-role', '/api/line/webhook', '/liff', '/s/ABCD']) {
    const { res, called } = await run(p, { env, headers: { authorization: basic(PASS) }, method: p.startsWith('/api/') ? 'POST' : 'GET', body: p.startsWith('/api/') ? '{}' : undefined })
    ok(`${label}: ${p} -> 503, app not called`, res.status === 503 && called === 0, `${res.status}/${called}`)
  }
}

// --- locked: no credentials / wrong password / malformed header -> 401
for (const [label, headers] of [['no credentials', {}], ['wrong password', { authorization: basic(PASS + 'x') }], ['prefix of password', { authorization: basic(PASS.slice(0, 20)) }],
  ['malformed base64', { authorization: 'Basic %%%' }], ['Bearer token', { authorization: 'Bearer eyJhbGciOi.x.y' }], ['forged cookie', { cookie: `${PROD_GATE_COOKIE}=deadbeef` }]]) {
  for (const [m, p] of [['GET', '/'], ['POST', '/api/member/account/delete'], ['POST', '/api/line/webhook'], ['GET', '/api/dashboard/operations/reports']]) {
    const { res, called } = await run(p, { headers, method: m, body: m === 'POST' ? '{}' : undefined })
    ok(`${label}: ${m} ${p} -> 401, app not called`, res.status === 401 && called === 0 && /Basic/.test(res.headers.get('www-authenticate') || ''), `${res.status}/${called}`)
  }
}
{
  const { res } = await run('/')
  ok('401 has noindex + no-store + x-prod-gate', res.headers.get('x-robots-tag')?.includes('noindex') && res.headers.get('cache-control') === 'no-store' && res.headers.get('x-prod-gate') === 'locked')
}

// --- correct password -> app, Basic header stripped, signed cookie issued
let cookieValue = ''
{
  const { res, called, fwd } = await run('/api/auth/whoami', { headers: { authorization: basic(PASS), 'x-other': 'kept' } })
  const sc = res.headers.get('set-cookie') || ''
  cookieValue = (sc.match(new RegExp(`${PROD_GATE_COOKIE}=([0-9a-f]{64})`)) || [])[1] || ''
  ok('correct password -> app called once', res.status === 200 && called === 1)
  ok('Basic authorization stripped before app', fwd && fwd.headers.get('authorization') === null && fwd.headers.get('x-other') === 'kept')
  ok('cookie is HttpOnly; Secure; SameSite=Lax; 12h', /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc) && /Max-Age=43200/.test(sc) && cookieValue.length === 64, sc)
  ok('cookie does not contain the password', !sc.includes(PASS))
  ok('gated response marked noindex + x-prod-gate', res.headers.get('x-robots-tag')?.includes('noindex') && res.headers.get('x-prod-gate') === 'locked' && res.headers.get('x-app') === '1')
}
{
  const { res, called, fwd } = await run('/api/sessions/x/participants/broadcast', { method: 'POST', body: '{"a":1}', headers: { cookie: `a=b; ${PROD_GATE_COOKIE}=${cookieValue}`, authorization: 'Bearer user-jwt' } })
  ok('valid cookie -> app (POST body preserved)', res.status === 200 && called === 1 && (await fwd.text()) === '{"a":1}')
  ok('Bearer authorization passed through to app', fwd.headers.get('authorization') === 'Bearer user-jwt')
  ok('no new cookie when already authenticated', !res.headers.get('set-cookie'))
}
{
  const { res, called } = await run('/', { env: { PROD_GATE_PASSWORD: 'another-password-123456' }, headers: { cookie: `${PROD_GATE_COOKIE}=${cookieValue}` } })
  ok('cookie invalid after password rotation -> 401', res.status === 401 && called === 0)
}

// --- public: only PROD_SITE_PUBLIC === '1'
{
  const { res, called, fwd } = await run('/api/line/webhook', { env: { PROD_SITE_PUBLIC: '1' }, method: 'POST', body: '{}', headers: { 'x-line-signature': 's' } })
  ok('PROD_SITE_PUBLIC=1 -> app directly (even without password)', res.status === 200 && called === 1 && fwd.headers.get('x-line-signature') === 's')
  ok('public response not marked locked', res.headers.get('x-prod-gate') === null)
}

// --- form login (tablets / LINE in-app browser)
const HTML = { accept: 'text/html,application/xhtml+xml' }
const form = (o) => new URLSearchParams(o).toString()
const FORM_H = { 'content-type': 'application/x-www-form-urlencoded' }
{
  const { res, called } = await run('/dashboard/operations?x=1', { headers: HTML })
  const body = await res.text()
  ok('browser page without credentials -> 401 password form, app not called', res.status === 401 && called === 0 && /<form method="post" action="\/__gate">/.test(body))
  ok('form page has no Basic challenge (no native dialog)', res.headers.get('www-authenticate') === null)
  ok('form keeps the requested path in next', body.includes('value="/dashboard/operations?x=1"'))
  ok('form page: noindex, no-store, frame-ancestors none', res.headers.get('x-robots-tag')?.includes('noindex') && res.headers.get('cache-control') === 'no-store' && /frame-ancestors 'none'/.test(res.headers.get('content-security-policy') || ''))
}
{
  const { res, called } = await run('/api/dashboard/operations/summary', { headers: HTML })
  ok('API path with Accept html still -> 401 Basic (no form)', res.status === 401 && called === 0 && /Basic/.test(res.headers.get('www-authenticate') || ''))
}
{
  const { res, called } = await run('/__gate', { headers: HTML })
  ok('GET /__gate -> 200 form, app not called', res.status === 200 && called === 0 && /type="password"/.test(await res.text()))
}
{
  const { res, called } = await run('/__gate', { method: 'POST', headers: FORM_H, body: form({ password: PASS, next: '/dashboard/operations' }) })
  const sc = res.headers.get('set-cookie') || ''
  ok('POST /__gate correct -> 303 to next with signed cookie, app not called', res.status === 303 && res.headers.get('location') === '/dashboard/operations' && sc.includes(`${PROD_GATE_COOKIE}=${cookieValue}`) && /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && called === 0)
  ok('cookie from form == cookie from Basic login', sc.includes(cookieValue))
}
{
  const { res, called } = await run('/__gate', { method: 'POST', headers: FORM_H, body: form({ password: PASS + 'x', next: '/' }) })
  ok('POST /__gate wrong -> 401 form with error, no cookie', res.status === 401 && !res.headers.get('set-cookie') && /密碼錯誤/.test(await res.text()) && called === 0)
}
{
  const { res } = await run('/__gate', { method: 'POST', headers: FORM_H, body: form({ next: '/' }) })
  ok('POST /__gate empty password -> 401, no cookie', res.status === 401 && !res.headers.get('set-cookie'))
}
for (const [bad, label] of [['//evil.example/x', 'protocol-relative'], ['https://evil.example/', 'absolute URL'], ['/\\evil.example', 'backslash'], ['/__gate?next=/x', 'gate loop'], ['javascript:alert(1)', 'javascript:'], ['/ok\r\nSet-Cookie: x=1', 'CRLF']]) {
  const { res } = await run('/__gate', { method: 'POST', headers: FORM_H, body: form({ password: PASS, next: bad }) })
  ok(`open redirect blocked (${label}) -> location /`, res.status === 303 && res.headers.get('location') === '/', res.headers.get('location'))
}
{
  const { res } = await run('/__gate?next=' + encodeURIComponent('/"><script>alert(1)</script>'), { headers: HTML })
  const body = await res.text()
  ok('next is HTML-escaped in the form', !body.includes('<script>alert') && body.includes('&quot;&gt;&lt;script&gt;'))
}
{
  const { res, called } = await run('/__gate', { env: {}, method: 'POST', headers: FORM_H, body: form({ password: 'anything-anything', next: '/' }) })
  ok('no PROD_GATE_PASSWORD: /__gate also 503 (fail closed)', res.status === 503 && called === 0)
}

// --- build flag
const prev = process.env.NEXT_PUBLIC_PROD_ACCESS_GATE
process.env.NEXT_PUBLIC_PROD_ACCESS_GATE = '1'; ok('build flag "1" enables gate', isProdGateBuild() === true)
process.env.NEXT_PUBLIC_PROD_ACCESS_GATE = 'true'; ok('build flag other than "1" does not', isProdGateBuild() === false)
if (prev === undefined) delete process.env.NEXT_PUBLIC_PROD_ACCESS_GATE; else process.env.NEXT_PUBLIC_PROD_ACCESS_GATE = prev

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
