/**
 * Demo Preview 的假 Supabase 後端（只在 isDemoPreview() 為真時使用）。
 * - 只回應 DEMO_SUPABASE_URL，其他網址一律拒絕，不會發出任何真實網路請求。
 * - 讀取（GET 資料表、get_* / is_* RPC）回傳本檔的假資料。
 * - 所有寫入（POST / PATCH / PUT / DELETE 資料表、其他 RPC、註冊）一律回 403 DEMO_READ_ONLY，
 *   因此不會產生報名、扣款、付款、分潤或 LINE 推播。
 */
import { DEMO_LOGIN_EMAIL, DEMO_LOGIN_PASSWORD, DEMO_SHARE_CODE, DEMO_SUPABASE_URL } from './demoPreview'

const DEMO_USER_ID = 'de000000-0000-4000-8000-000000000001'
const DEMO_PLAYER_ID = 'de000000-0000-4000-8000-000000000002'
const DEMO_VENUE_ID = 'de000000-0000-4000-8000-000000000003'
const DEMO_SESSION_ID = 'de000000-0000-4000-8000-000000000004'

type Row = Record<string, unknown>

function nextSessionTimes(): { start: string; end: string } {
  // 三天後 19:00–22:00（台北時間）
  const d = new Date(Date.now() + 3 * 86400_000)
  const ymd = d.toISOString().slice(0, 10)
  return { start: `${ymd}T19:00:00+08:00`, end: `${ymd}T22:00:00+08:00` }
}

function tables(): Record<string, Row[]> {
  const { start, end } = nextSessionTimes()
  const now = new Date().toISOString()
  return {
    app_user_profiles: [
      { id: DEMO_USER_ID, display_name: '測試球友', primary_role: 'player', is_active: true, created_at: now, updated_at: now },
    ],
    players: [
      { id: DEMO_PLAYER_ID, auth_user_id: DEMO_USER_ID, display_name: '測試球友', level: 6, created_at: now },
    ],
    venues: [
      {
        id: DEMO_VENUE_ID,
        name: '示範羽球館（測試資料）',
        address_text: '示範路 1 號',
        city: '台北市',
        district: '示範區',
        full_address: '台北市示範區示範路 1 號',
        google_maps_url: null,
      },
    ],
    sessions: [
      {
        id: DEMO_SESSION_ID,
        title: '週末臨打（測試預覽）',
        description: '此為測試預覽的假資料，無法實際報名。',
        status: 'registration_open',
        share_signup_code: DEMO_SHARE_CODE,
        venue_id: DEMO_VENUE_ID,
        start_at: start,
        end_at: end,
        court_count: 3,
        fee_description: '含球',
        metadata: { max_participants: 12, fee_twd: 200, shuttlecock_type: 'feather', rented_court_nos: [1, 2, 3] },
        created_at: now,
      },
    ],
  }
}

const ROSTER_NAMES = ['小明', '阿華', 'Kevin', '小美', '阿傑', 'Amy', '志豪', '雅婷', '俊宏', '佳玲']

function rpcResult(name: string, args: Row): { status: number; body: unknown } {
  switch (name) {
    case 'get_public_session_roster_by_share_code': {
      const ok = String(args.p_share_code ?? '').toUpperCase() === DEMO_SHARE_CODE
      return {
        status: 200,
        body: ok
          ? ROSTER_NAMES.map((n, i) => ({
              session_participant_id: `de0000ff-0000-4000-8000-${String(i).padStart(12, '0')}`,
              roster_kind: i < 8 ? 'main' : 'waitlist',
              display_name: n,
              waitlist_order: i < 8 ? null : i - 7,
              is_self: false,
              guest_level: null,
              is_managed_by_registrar: false,
            }))
          : [],
      }
    }
    case 'get_public_pickup_group_prefs_by_share_code':
      return { status: 200, body: [{ rented_courts_display_mode: 'below', theme_preset: 'indigo', theme_custom: null }] }
    case 'get_public_platform_line_oa':
      return { status: 200, body: [] }
  }
  if (name.startsWith('is_')) return { status: 200, body: false }
  if (name.startsWith('get_') || name.startsWith('kb_get_')) return { status: 200, body: [] }
  return readOnlyError()
}

function readOnlyError(): { status: number; body: unknown } {
  return {
    status: 403,
    body: { code: '42501', message: 'DEMO_READ_ONLY：測試預覽不允許寫入或執行此操作', details: null, hint: null },
  }
}

function matches(row: Row, col: string, expr: string): boolean {
  const dot = expr.indexOf('.')
  if (dot < 0) return true
  let op = expr.slice(0, dot)
  let val = expr.slice(dot + 1)
  let negate = false
  if (op === 'not') {
    negate = true
    const d2 = val.indexOf('.')
    op = val.slice(0, d2)
    val = val.slice(d2 + 1)
  }
  const cell = row[col]
  const s = cell == null ? null : String(cell)
  let r: boolean
  switch (op) {
    case 'eq': r = s === val; break
    case 'neq': r = s !== val; break
    case 'is': r = val === 'null' ? cell == null : String(cell) === val; break
    case 'in': r = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(s ?? ''); break
    case 'like':
    case 'ilike': {
      const re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*') + '$', op === 'ilike' ? 'i' : '')
      r = s != null && re.test(s)
      break
    }
    case 'gt': r = s != null && s > val; break
    case 'gte': r = s != null && s >= val; break
    case 'lt': r = s != null && s < val; break
    case 'lte': r = s != null && s <= val; break
    default: r = true // 未支援的運算子：寬鬆處理（只影響假資料顯示）
  }
  return negate ? !r : r
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns'])

function b64url(obj: unknown): string {
  const s = btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function demoUser(): Row {
  const now = new Date().toISOString()
  return {
    id: DEMO_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEMO_LOGIN_EMAIL,
    app_metadata: { provider: 'email', providers: ['email'], demo_preview: true },
    user_metadata: { display_name: '測試球友' },
    created_at: now,
    updated_at: now,
  }
}

function demoSession(): Row {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: DEMO_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEMO_LOGIN_EMAIL,
    exp,
    iat: exp - 3600,
    demo_preview: true,
  })}.ZGVtby1wcmV2aWV3LW5vdC1zaWduZWQ`
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'demo-preview-refresh',
    user: demoUser(),
  }
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  if (status === 204) return new Response(null, { status })
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  })
}

async function readJson(init?: RequestInit, req?: Request): Promise<Row> {
  try {
    if (req) return (await req.clone().json()) as Row
    if (typeof init?.body === 'string') return JSON.parse(init.body) as Row
  } catch {
    // ignore
  }
  return {}
}

export const demoFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : undefined
  const url = new URL(req ? req.url : String(input))
  const method = (init?.method || req?.method || 'GET').toUpperCase()
  const headers = new Headers(init?.headers || req?.headers)

  if (url.origin !== DEMO_SUPABASE_URL) {
    return json(403, { code: 'DEMO_BLOCKED', message: 'Demo Preview 不允許連線至其他主機' })
  }

  const path = url.pathname

  // ---- Auth ---------------------------------------------------------------
  if (path.startsWith('/auth/v1/')) {
    const ep = path.slice('/auth/v1/'.length)
    if (ep === 'token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'refresh_token') return json(200, demoSession())
      if (grant === 'password') {
        const body = await readJson(init, req)
        if (String(body.email ?? '').trim().toLowerCase() === DEMO_LOGIN_EMAIL && body.password === DEMO_LOGIN_PASSWORD) {
          return json(200, demoSession())
        }
        return json(400, {
          code: 'invalid_credentials',
          error_code: 'invalid_credentials',
          msg: `測試預覽只接受示範帳號 ${DEMO_LOGIN_EMAIL} / ${DEMO_LOGIN_PASSWORD}`,
        })
      }
      return json(400, { code: 'unsupported_grant_type', msg: '測試預覽不支援此登入方式' })
    }
    if (ep === 'user' && method === 'GET') {
      const auth = headers.get('authorization') || ''
      if (/^bearer\s+\S+\.\S+\.\S+$/i.test(auth) && auth.includes(b64url({ alg: 'HS256', typ: 'JWT' }))) {
        return json(200, demoUser())
      }
      return json(401, { code: 'no_authorization', msg: 'not logged in' })
    }
    if (ep === 'logout') return json(204, null)
    return json(403, { code: 'DEMO_READ_ONLY', msg: '測試預覽不支援註冊、重設密碼或其他帳號操作' })
  }

  // ---- PostgREST ------------------------------------------------------------
  if (path.startsWith('/rest/v1/')) {
    const name = decodeURIComponent(path.slice('/rest/v1/'.length))
    if (name.startsWith('rpc/')) {
      const fn = name.slice(4)
      const args = method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(init, req)
      const r = rpcResult(fn, args)
      return json(r.status, r.body)
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const r = readOnlyError()
      return json(r.status, r.body)
    }
    let rows = tables()[name] ?? []
    for (const [k, v] of url.searchParams) {
      if (RESERVED.has(k)) continue
      rows = rows.filter((row) => matches(row, k, v))
    }
    const total = rows.length
    const offset = Number(url.searchParams.get('offset') || 0)
    const limit = url.searchParams.get('limit')
    rows = rows.slice(offset, limit != null ? offset + Number(limit) : undefined)
    const range = { 'content-range': rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}` }
    if (method === 'HEAD') return new Response(null, { status: 200, headers: range })
    if ((headers.get('accept') || '').includes('vnd.pgrst.object')) {
      if (rows.length !== 1) {
        return json(406, {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${rows.length} rows`,
          hint: null,
        })
      }
      return json(200, rows[0], range)
    }
    return json(200, rows, range)
  }

  // Storage / Realtime / Functions 等：一律拒絕
  return json(403, { code: 'DEMO_READ_ONLY', message: '測試預覽不支援此服務' })
}

/** Realtime 在 Demo 模式不連線（假網域無法建立 WebSocket），改為無作用的頻道。 */
export function disableRealtimeForDemo<T extends { channel: any; removeChannel: any }>(client: T): T {
  const noop = {
    on() {
      return noop
    },
    subscribe() {
      return noop
    },
    unsubscribe() {
      return Promise.resolve('ok')
    },
  }
  client.channel = () => noop
  client.removeChannel = () => Promise.resolve('ok')
  return client
}
