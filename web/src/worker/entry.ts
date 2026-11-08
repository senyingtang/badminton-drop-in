/**
 * Cloudflare Worker 入口：包住 vinext 的 fetch handler。
 * 一般建置（Demo / Staging）直接交給 app；唯讀整合測試建置（NEXT_PUBLIC_READONLY_PREVIEW=1）先經過閘門：
 *   1. 存取控制：Basic Auth（密碼為 Worker secret PREVIEW_ACCESS_PASSWORD）→ 發 HttpOnly 簽章 Cookie。
 *      未設定 secret 時整站 503（fail closed）。
 *   2. /__supabase/*：唯讀 Supabase 代理（規則見 src/lib/readonly/readonlyPreview.ts）。
 *   3. 其他非 GET / HEAD 請求一律 403，只允許密碼登入。
 *   4. LINE、付款、訂閱、AI、帳號刪除等有外部副作用的路徑，任何方法都 403。
 */
import app from 'vinext/server/fetch-handler'
export * from 'vinext/server/fetch-handler'
import {
  filterSupabaseRequest,
  isReadonlyPreview,
  readonlyDeniedResponse,
} from '../lib/readonly/readonlyPreview'

type Env = { PREVIEW_ACCESS_PASSWORD?: string; [k: string]: unknown }
type Ctx = { waitUntil(p: Promise<unknown>): void; passThroughOnException?(): void }
type AppHandler = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> | Response }

const GATE_COOKIE = '__ro_gate'
const SUPABASE_PREFIX = '/__supabase'

const BLOCKED_PREFIXES = [
  '/api/line/',
  '/api/auth/line/',
  '/api/payments/',
  '/api/subscriptions/',
  '/api/ai/',
  '/api/member/account/',
  '/api/member/line-binding-code',
  '/api/players/ensure-self',
  '/api/public/signup-error-log',
  '/api/auth/post-signup-referral',
  '/api/auth/clear-pending-referral',
  '/liff',
  '/liff-entry',
]
const ALLOWED_POSTS = new Set(['/api/auth/password-login'])

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...headers },
  })
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** 回傳 null = 通過；否則為 401 / 503 回應。通過 Basic Auth 時 setCookie 帶出簽章 Cookie。 */
async function checkAccess(req: Request, env: Env): Promise<{ deny: Response | null; setCookie?: string }> {
  const pass = typeof env.PREVIEW_ACCESS_PASSWORD === 'string' ? env.PREVIEW_ACCESS_PASSWORD : ''
  if (pass.length < 16) return { deny: text(503, 'Read-only preview is locked: PREVIEW_ACCESS_PASSWORD is not configured.') }
  const token = await hmac(pass, 'readonly-preview-v1')
  const cookie = readCookie(req, GATE_COOKIE)
  if (cookie && safeEqual(cookie, token)) return { deny: null }
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Basic ')) {
    let decoded = ''
    try {
      decoded = atob(auth.slice(6))
    } catch {
      decoded = ''
    }
    const given = decoded.slice(decoded.indexOf(':') + 1)
    if (safeEqual(await hmac(pass, given), await hmac(pass, pass))) {
      return { deny: null, setCookie: `${GATE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` }
    }
  }
  return {
    deny: text(401, '整合測試站（唯讀）：需要存取密碼。', { 'www-authenticate': 'Basic realm="badminton read-only preview", charset="UTF-8"' }),
  }
}

async function proxySupabase(req: Request, url: URL): Promise<Response> {
  const target = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '')
  if (!target) return text(503, 'Supabase URL missing')
  const path = url.pathname.slice(SUPABASE_PREFIX.length) || '/'
  const method = req.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? null : await req.text()
  const r = filterSupabaseRequest(method, path, url.search, body)
  if (r.action === 'deny') return readonlyDeniedResponse(r.reason)

  const headers = new Headers()
  for (const h of ['authorization', 'apikey', 'accept', 'accept-profile', 'content-profile', 'prefer', 'range', 'range-unit', 'x-client-info', 'content-type']) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  // 不轉送本站 Cookie 與 Basic Auth 給 Supabase
  if ((headers.get('authorization') || '').startsWith('Basic ')) headers.delete('authorization')

  if (r.action === 'rpc_as_get') {
    headers.delete('content-type')
    return fetch(`${target}${r.url}`, { method: 'GET', headers })
  }
  return fetch(`${target}${path}${url.search}`, { method, headers, body })
}

async function gate(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url)
  const access = await checkAccess(req, env)
  if (access.deny) return access.deny

  const method = req.method.toUpperCase()
  const path = url.pathname
  let res: Response
  if (path === SUPABASE_PREFIX || path.startsWith(`${SUPABASE_PREFIX}/`)) {
    res = await proxySupabase(req, url)
  } else if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || path === p.replace(/\/$/, ''))) {
    res = readonlyDeniedResponse(`path ${path}`)
  } else if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && ALLOWED_POSTS.has(path))) {
    res = readonlyDeniedResponse(`${method} ${path}`)
  } else {
    res = await (app as unknown as AppHandler).fetch(req, env, ctx)
  }

  const out = new Response(res.body, res)
  out.headers.set('x-robots-tag', 'noindex, nofollow')
  out.headers.set('x-readonly-preview', '1')
  if (access.setCookie) out.headers.append('set-cookie', access.setCookie)
  return out
}

const worker = {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (!isReadonlyPreview()) return (app as unknown as AppHandler).fetch(request, env, ctx)
    return gate(request, env, ctx)
  },
}

export default worker
