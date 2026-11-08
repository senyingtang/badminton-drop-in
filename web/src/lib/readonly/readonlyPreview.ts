/**
 * Read-only Preview（唯讀整合測試）模式。
 *
 * 用途：Cloudflare 整合測試 Worker 直接讀「正式 Supabase」，但絕對不能寫入。
 * 只有建置時 NEXT_PUBLIC_READONLY_PREVIEW = "1" 才啟用；Vercel 正式建置沒有這個變數，所以不受影響。
 *
 * 防線（由外而內）：
 *   1. Worker 閘門（src/worker/entry.ts）：存取密碼；非 GET 請求一律 403（登入 / 登出除外）；
 *      LINE / 付款 / 訂閱 / AI / 帳號刪除等路徑整個封鎖。
 *   2. Supabase 請求過濾（本檔 filterSupabaseRequest）：瀏覽器的 Supabase 請求改經 Worker 的 /__supabase 代理，
 *      伺服端（middleware、API、Server Component）的 Supabase 請求經 readonlyServerFetch；兩者套用同一套規則：
 *        - 資料表只允許 GET / HEAD（PostgREST 以唯讀交易執行）。
 *        - RPC 只允許白名單，且一律改成 GET 呼叫（PostgREST 以唯讀交易執行，函式內任何寫入都會被資料庫拒絕）。
 *        - Auth 只允許密碼登入、刷新 session、讀取目前使用者、登出。
 *        - Storage 只允許 GET；Realtime 停用。
 *   3. 不設定 SUPABASE_SERVICE_ROLE_KEY：service-role client 一律為 null。
 */

export function isReadonlyPreview(): boolean {
  return process.env.NEXT_PUBLIC_READONLY_PREVIEW === '1'
}

/** 只讀函式。改用 GET 呼叫，由資料庫保證唯讀；函式若嘗試寫入會失敗，而不是寫入。 */
export const READ_RPC_ALLOWLIST = new Set([
  'get_public_session_roster_by_share_code',
  'get_public_pickup_group_prefs_by_share_code',
  'get_public_platform_line_oa',
  'list_session_participants_for_host',
  'list_host_player_profiles_for_self',
  'kb_get_quota_dashboard',
  'kb_admin_get_kpis',
  'member_referral_lookup_active_code',
  'resolve_commission_rate',
  'commission_events_admin_summary',
  'is_platform_admin',
  'is_host',
  'is_venue_owner',
])

export type FilterResult =
  | { action: 'allow' }
  | { action: 'rpc_as_get'; url: string }
  | { action: 'deny'; reason: string }

/**
 * @param path    Supabase 路徑（含 /rest/v1、/auth/v1 …）
 * @param search  query string（含 ?）
 */
export function filterSupabaseRequest(method: string, path: string, search: string, body: string | null): FilterResult {
  const m = method.toUpperCase()
  const params = new URLSearchParams(search)

  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = decodeURIComponent(path.slice('/rest/v1/rpc/'.length))
    if (!READ_RPC_ALLOWLIST.has(fn)) return { action: 'deny', reason: `rpc ${fn} is not read-only` }
    if (m === 'GET' || m === 'HEAD') return { action: 'allow' }
    if (m !== 'POST') return { action: 'deny', reason: `rpc ${fn} via ${m}` }
    let args: Record<string, unknown> = {}
    try {
      args = body ? (JSON.parse(body) as Record<string, unknown>) : {}
    } catch {
      return { action: 'deny', reason: 'rpc body is not JSON' }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { action: 'deny', reason: 'rpc body must be an object' }
    const q = new URLSearchParams(params)
    for (const [k, v] of Object.entries(args)) {
      if (v === null || v === undefined) continue // null 參數改用函式預設值
      if (typeof v === 'object') return { action: 'deny', reason: `rpc arg ${k} is not scalar` }
      q.set(k, String(v))
    }
    const qs = q.toString()
    return { action: 'rpc_as_get', url: `${path}${qs ? `?${qs}` : ''}` }
  }

  if (path.startsWith('/rest/v1/')) {
    return m === 'GET' || m === 'HEAD' ? { action: 'allow' } : { action: 'deny', reason: `table write ${m}` }
  }

  if (path.startsWith('/auth/v1/')) {
    const ep = path.slice('/auth/v1/'.length)
    if (ep === 'token' && m === 'POST') {
      const grant = params.get('grant_type')
      return grant === 'password' || grant === 'refresh_token' ? { action: 'allow' } : { action: 'deny', reason: `auth grant ${grant}` }
    }
    if (ep === 'user' && m === 'GET') return { action: 'allow' }
    if (ep === 'logout' && m === 'POST') return { action: 'allow' }
    if ((ep === 'settings' || ep === 'health' || ep === '.well-known/jwks.json') && m === 'GET') return { action: 'allow' }
    return { action: 'deny', reason: `auth ${m} ${ep}` }
  }

  if (path.startsWith('/storage/v1/')) {
    return m === 'GET' || m === 'HEAD' ? { action: 'allow' } : { action: 'deny', reason: `storage ${m}` }
  }

  return { action: 'deny', reason: `service ${path.split('/')[1] || '?'}` }
}

export function readonlyDeniedResponse(reason: string): Response {
  return new Response(
    JSON.stringify({ code: '42501', message: `READ_ONLY_PREVIEW：整合測試站不允許寫入（${reason}）`, details: null, hint: null }),
    { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } }
  )
}

async function bodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (init?.body != null) {
    if (typeof init.body === 'string') return init.body
    try {
      return await new Response(init.body).text()
    } catch {
      return null
    }
  }
  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return null
    }
  }
  return null
}

/** 伺服端 Supabase fetch：套用唯讀規則後直接連 Supabase。 */
export const readonlyServerFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : undefined
  const url = new URL(req ? req.url : String(input))
  const method = (init?.method || req?.method || 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? null : await bodyText(input, init)
  const r = filterSupabaseRequest(method, url.pathname, url.search, body)
  if (r.action === 'deny') return readonlyDeniedResponse(r.reason)
  if (r.action === 'rpc_as_get') {
    const headers = new Headers(init?.headers || req?.headers)
    headers.delete('content-type')
    headers.delete('content-length')
    return fetch(`${url.origin}${r.url}`, { method: 'GET', headers, signal: init?.signal ?? req?.signal })
  }
  return fetch(input, init)
}

/** 瀏覽器 Supabase fetch：把請求轉到同網域的 /__supabase 代理（由 Worker 閘門套用唯讀規則）。 */
export function readonlyBrowserFetch(supabaseUrl: string): typeof fetch {
  const origin = new URL(supabaseUrl).origin
  return (input, init) => {
    const req = input instanceof Request ? input : undefined
    const raw = req ? req.url : String(input)
    if (!raw.startsWith(origin)) return fetch(input, init)
    const proxied = `${window.location.origin}/__supabase${raw.slice(origin.length)}`
    return req ? fetch(new Request(proxied, req), init) : fetch(proxied, init)
  }
}
