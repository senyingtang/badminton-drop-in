/**
 * 正式 Worker（badminton-drop-in-prod）切換前存取閘門 —— fail closed。
 *
 * 只在正式建置啟用（cf-deploy-prod.ps1 強制 NEXT_PUBLIC_PROD_ACCESS_GATE=1；其他 Worker 不受影響）。
 * 執行期由 Worker secrets 控制（secrets 跨部署保留；一般 vars 會被部署覆蓋，所以不用 vars）：
 *   - PROD_SITE_PUBLIC === '1'      → 正式公開（切換當天才設定）。任何其他值或未設定 → 上鎖。
 *   - 上鎖時：需要 PROD_GATE_PASSWORD（至少 16 字元）的 Basic Auth → 發 HttpOnly 簽章 Cookie（12 小時）。
 *     PROD_GATE_PASSWORD 未設定或太短 → 整站 503（包含 /api/*），不會意外對外開放。
 *   - 上鎖時所有路徑都要驗證（含 /api/line/webhook、/liff）：切換前 LINE 仍指向 Vercel。
 *   - 通過閘門後轉給 App 前移除 Basic Authorization 標頭，避免 App 把它當成 Bearer token。
 *   - Cookie 為 SameSite=Lax：LINE Login 回跳（頂層 GET 導向）會帶上，測試人員可在上鎖時測 LINE 登入。
 *   - 瀏覽器頁面（GET + Accept: text/html，非 /api/）未通過時顯示密碼表單（/__gate），
 *     因為平板 / LINE 內建瀏覽器不一定顯示 Basic Auth 對話框；API 與腳本仍用 Basic Auth（401）。
 * 本模組不 import vinext，方便單元測試（scripts/tests/prod-gate.test.mjs）。
 */

export type ProdGateEnv = { PROD_GATE_PASSWORD?: unknown; PROD_SITE_PUBLIC?: unknown; [k: string]: unknown }
export type Next = (req: Request) => Promise<Response> | Response

export const PROD_GATE_COOKIE = '__prod_gate'
const TOKEN_LABEL = 'prod-gate-v1'
const MIN_PASSWORD = 16

export function isProdGateBuild(): boolean {
  return process.env.NEXT_PUBLIC_PROD_ACCESS_GATE === '1'
}

export function isProdSitePublic(env: ProdGateEnv): boolean {
  return env.PROD_SITE_PUBLIC === '1'
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-prod-gate': 'locked',
      ...headers,
    },
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

function decodeBasicPassword(header: string): string | null {
  if (!header.startsWith('Basic ')) return null
  let decoded = ''
  try {
    decoded = atob(header.slice(6).trim())
  } catch {
    return null
  }
  const i = decoded.indexOf(':')
  return i >= 0 ? decoded.slice(i + 1) : null
}

export const GATE_PATH = '/__gate'

/** 只允許站內相對路徑，避免 open redirect。 */
export function safeNext(raw: string): string {
  const v = (raw || '').trim()
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.startsWith(GATE_PATH)) return '/'
  if (/[\r\n]/.test(v)) return '/'
  return v.slice(0, 1000)
}

function wantsHtml(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const path = new URL(req.url).pathname
  if (path.startsWith('/api/') || path.startsWith('/_next/')) return false
  return (req.headers.get('accept') || '').includes('text/html')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function gatePage(nextPath: string, failed: boolean, status = failed ? 401 : 200): Response {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>正式站尚未開放</title>
<style>body{font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;background:#f4f6fb;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
form{background:#fff;padding:24px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:100%;max-width:360px}
h1{font-size:20px;margin:0 0 8px}p{color:#555;font-size:14px;margin:0 0 16px}
input,button{width:100%;box-sizing:border-box;font-size:16px;padding:12px;border-radius:8px}
input{border:1px solid #ccc;margin-bottom:12px}button{border:0;background:#2563eb;color:#fff;font-weight:600}
.err{color:#b91c1c}</style></head><body>
<form method="post" action="${GATE_PATH}">
<h1>正式站尚未開放</h1><p>切換前測試中，請輸入存取密碼。</p>
${failed ? '<p class="err">密碼錯誤，請再試一次。</p>' : ''}
<input type="password" name="password" autocomplete="current-password" autofocus required aria-label="存取密碼">
<input type="hidden" name="next" value="${escapeHtml(nextPath)}">
<button type="submit">進入</button></form></body></html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-prod-gate': 'locked',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  })
}

/** 閘門主體。public 時直接交給 next；否則驗證後交給 next，並加上 noindex / 標記標頭。 */
export async function prodGate(req: Request, env: ProdGateEnv, next: Next): Promise<Response> {
  if (isProdSitePublic(env)) return next(req)

  const pass = typeof env.PROD_GATE_PASSWORD === 'string' ? env.PROD_GATE_PASSWORD : ''
  if (pass.length < MIN_PASSWORD) {
    return text(503, '正式站尚未開放（存取閘門未設定，fail closed）。')
  }

  const token = await hmac(pass, TOKEN_LABEL)
  const gateCookie = `${PROD_GATE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
  const passwordMatches = async (given: string) => safeEqual(await hmac(pass, given), await hmac(pass, pass)) // 固定長度比較
  const url = new URL(req.url)

  // 表單登入（平板 / 手機 / LINE 內建瀏覽器不一定支援 Basic Auth 對話框）
  if (url.pathname === GATE_PATH) {
    if (req.method === 'POST') {
      const form = await req.formData().catch(() => null)
      const given = typeof form?.get('password') === 'string' ? (form.get('password') as string) : ''
      const nextPath = safeNext(typeof form?.get('next') === 'string' ? (form.get('next') as string) : '/')
      if (given && (await passwordMatches(given))) {
        return new Response(null, {
          status: 303,
          headers: { location: nextPath, 'set-cookie': gateCookie, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-prod-gate': 'locked' },
        })
      }
      return gatePage(nextPath, true)
    }
    return gatePage(safeNext(url.searchParams.get('next') || '/'), false)
  }

  let setCookie: string | undefined
  const cookie = readCookie(req, PROD_GATE_COOKIE)
  let ok = Boolean(cookie && safeEqual(cookie, token))
  const authHeader = req.headers.get('authorization') || ''
  if (!ok) {
    const given = decodeBasicPassword(authHeader)
    if (given !== null && (await passwordMatches(given))) {
      ok = true
      setCookie = gateCookie
    }
  }
  if (!ok) {
    // 瀏覽器頁面 → 密碼表單；API / 腳本 → 401 + Basic Auth
    if (wantsHtml(req)) return gatePage(safeNext(url.pathname + url.search), false, 401)
    return text(401, '正式站尚未開放：需要存取密碼。', {
      'www-authenticate': 'Basic realm="badminton production (pre-cutover)", charset="UTF-8"',
    })
  }

  let forward = req
  if (authHeader.startsWith('Basic ')) {
    const headers = new Headers(req.headers)
    headers.delete('authorization')
    forward = new Request(req, { headers })
  }
  const res = await next(forward)
  const out = new Response(res.body, res)
  out.headers.set('x-robots-tag', 'noindex, nofollow')
  out.headers.set('x-prod-gate', 'locked')
  if (setCookie) out.headers.append('set-cookie', setCookie)
  return out
}
