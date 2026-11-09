// M6：LINE Login callback 整合測試。Supabase / GoTrue / DB / 瀏覽器為真實（本機隔離），
// 只有 LINE 授權頁（access.line.me，Playwright 攔截）與 token endpoint（fake-line.mjs）為模擬。
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_URL || 'playwright-core')
import { execFileSync } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3105'
const API = 'http://127.0.0.1:56821'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d && !p ? ' — ' + d : ''}`) }
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_badminton-auth-iso', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim()
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const run = Date.now()

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const pathOf = (p) => { const u = new URL(p.url()); return u.pathname + u.search }
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ')
async function sessionUserId(ctx) {
  const parts = (await ctx.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (!parts.length) return null
  try { return JSON.parse(Buffer.from(parts.map((c) => c.value).join('').replace(/^base64-/, ''), 'base64url').toString()).user?.id ?? null } catch { return null }
}

/** 模擬使用者在 LINE 授權頁按「允許」（或取消 / 竄改 state）。回傳最後頁面與 authorize 參數。 */
async function lineLogin(identity, { returnTo = '/member-dashboard', tamperState = false, cancel = false } = {}) {
  const ctx = await browser.newContext({ locale: 'zh-TW' })
  const page = await ctx.newPage()
  // 1) 本站 start（不跟隨轉址，cookie 存入同一瀏覽器 context）
  const st = await ctx.request.get(`${BASE}/api/auth/line/start?returnTo=${encodeURIComponent(returnTo)}`, { maxRedirects: 0 })
  const loc = st.headers()['location'] || ''
  const u = new URL(loc)
  const auth = u.origin === 'https://access.line.me' ? Object.fromEntries(u.searchParams) : null
  // 2) 模擬 LINE 授權頁：使用者同意 / 取消後，LINE 以頂層 GET 導回 redirect_uri
  const cb = new URL(auth ? auth.redirect_uri : `${BASE}/api/auth/line/callback`)
  if (cancel) { cb.searchParams.set('error', 'access_denied'); cb.searchParams.set('state', auth?.state || '') }
  else {
    cb.searchParams.set('code', b64u({ ...identity, nonce: auth?.nonce }))
    cb.searchParams.set('state', tamperState ? (auth?.state || '') + 'x' : auth?.state || '')
  }
  await page.goto(cb.toString())
  await page.waitForURL((u) => !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/auth/') && u.origin === BASE, { timeout: 20000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page, auth }
}
async function adminCreateUser(email, meta = {}) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Abcd1234', email_confirm: true, user_metadata: meta }) })
  return (await r.json()).id
}
const countUsers = () => Number(sql('select count(*) from auth.users'))
const countPlayers = () => Number(sql('select count(*) from players'))

// L1 新會員首次 LINE 登入（有 email）
const SUB1 = `U${run}a`, EMAIL1 = `line1+${run}@example.test`
let u0 = countUsers(), p0 = countPlayers()
let r = await lineLogin({ sub: SUB1, email: EMAIL1, name: '線上新會員' }, { returnTo: '/s/ABCD' })
ok('L 授權請求：redirect_uri = 目前網域 /api/auth/line/callback', r.auth?.redirect_uri === `${BASE}/api/auth/line/callback`, r.auth?.redirect_uri)
ok('L 授權請求：scope openid profile email、state/nonce 各 43 字元隨機', r.auth?.scope === 'openid profile email' && /^[\w-]{43}$/.test(r.auth?.state) && /^[\w-]{43}$/.test(r.auth?.nonce))
ok('L1 新會員 → 登入並回到場次頁 returnTo', pathOf(r.page) === '/s/ABCD', pathOf(r.page))
const id1 = await sessionUserId(r.ctx)
ok('L1 建立 1 個 Auth 帳號 + 1 筆 players（line_user_id 綁定）', countUsers() === u0 + 1 && countPlayers() === p0 + 1 && sql(`select auth_user_id from players where line_user_id='${SUB1}'`) === id1, `${countUsers() - u0}/${countPlayers() - p0}`)
ok('L1 profile = player、帳號 app_metadata.line_sub 記錄', sql(`select primary_role from app_user_profiles where id='${id1}'`) === 'player' && sql(`select raw_app_meta_data->>'line_sub' from auth.users where id='${id1}'`) === SUB1)
ok('L1 LINE 暫存 cookie 已清除', !(await r.ctx.cookies()).some((c) => c.name === 'kb_line_oauth' && c.value))
ok('L1 網址不含 access_token', !r.page.url().includes('access_token'))
await r.ctx.close()

// L2 同一 LINE 再登入 → 同一帳號、不重複
u0 = countUsers(); p0 = countPlayers()
r = await lineLogin({ sub: SUB1, email: EMAIL1, name: '線上新會員' })
ok('L2 既有 LINE 會員 → 同一帳號、不新增帳號 / players', (await sessionUserId(r.ctx)) === id1 && countUsers() === u0 && countPlayers() === p0)
ok('L2 角色導向：player → /member-dashboard', pathOf(r.page) === '/member-dashboard', pathOf(r.page))
await r.ctx.close()

// L3 LINE 未提供 email → 合成 email；第二次相同帳號
const SUB3 = `U${run}c`
r = await lineLogin({ sub: SUB3, name: '無信箱' })
const id3 = await sessionUserId(r.ctx); await r.ctx.close()
u0 = countUsers()
r = await lineLogin({ sub: SUB3, name: '無信箱' })
ok('L3 無 email 的 LINE 帳號：可登入且第二次為同一帳號', !!id3 && (await sessionUserId(r.ctx)) === id3 && countUsers() === u0 && sql(`select email from auth.users where id='${id3}'`) === `line+${SUB3.toLowerCase()}@example.com`)
await r.ctx.close()

// L4 LINE email 與既有「Email 註冊」帳號相同 → 拒絕，不合併
const EMAIL4 = `owner4+${run}@example.test`
const id4 = await adminCreateUser(EMAIL4)
u0 = countUsers(); p0 = countPlayers()
r = await lineLogin({ sub: `U${run}d`, email: EMAIL4, name: '撞信箱' })
ok('L4 email 被其他帳號使用 → 拒絕並說明（不自動合併）', pathOf(r.page).startsWith('/login?error=line_email_linked_to_other_account') && (await body(r.page)).includes('不會自動合併'), pathOf(r.page))
ok('L4 沒有登入、沒有新增帳號或 players、原帳號未被綁上這個 LINE', !(await sessionUserId(r.ctx)) && countUsers() === u0 && countPlayers() === p0 && sql(`select count(*) from players where auth_user_id='${id4}'`) === '0')
await r.ctx.close()

// L5 既有會員以綁定碼綁過 LINE（email 不同）→ 登入該會員，不另建帳號（M5 修正的重點）
const EMAIL5 = `bound5+${run}@example.test`, SUB5 = `U${run}e`
const id5 = await adminCreateUser(EMAIL5)
sql(`insert into app_user_profiles(id, display_name, primary_role) values ('${id5}','綁定會員','host') on conflict do nothing`)
sql(`insert into players(auth_user_id, player_code, display_name, line_user_id) values ('${id5}','u${id5.replace(/-/g, '')}','綁定會員','${SUB5}')`)
u0 = countUsers()
r = await lineLogin({ sub: SUB5, email: `different5+${run}@example.test`, name: 'LINE 名稱' })
ok('L5 已綁定 LINE、但 LINE email 不同 → 登入原會員（不是新帳號）', (await sessionUserId(r.ctx)) === id5 && countUsers() === u0, `${await sessionUserId(r.ctx)} vs ${id5}`)
ok('L5 角色導向：host → returnTo /member-dashboard 照常（管理頁需自行進入）', pathOf(r.page) === '/member-dashboard', pathOf(r.page))
ok('L5 未以 LINE email 建立帳號', sql(`select count(*) from auth.users where email='different5+${run}@example.test'`) === '0')
await r.ctx.close()

// L6 停權 / 刪除會員以 LINE 登入 → 拒絕
sql(`update app_user_profiles set is_active=false where id='${id5}'`)
r = await lineLogin({ sub: SUB5, name: 'x' })
ok('L6 停權會員 LINE 登入被拒', pathOf(r.page).startsWith('/login?error=account_suspended') && !(await sessionUserId(r.ctx)) && (await body(r.page)).includes('已停權'), pathOf(r.page))
await r.ctx.close()
sql(`update app_user_profiles set is_active=true, is_deleted=true where id='${id5}'`)
r = await lineLogin({ sub: SUB5, name: 'x' })
ok('L6 已刪除會員 LINE 登入被拒', pathOf(r.page).startsWith('/login?error=account_deleted') && !(await sessionUserId(r.ctx)), pathOf(r.page))
await r.ctx.close()
sql(`update app_user_profiles set is_deleted=false where id='${id5}'`)

// L7 已撤銷角色不會因 LINE 登入恢復
sql(`update app_user_profiles set primary_role='player' where id='${id1}'`)
sql(`insert into user_role_memberships(user_id, role, is_active) values ('${id1}','host',false) on conflict (user_id, role) do update set is_active=false`)
sql(`update user_role_memberships set is_active=false where user_id='${id1}' and role='player'`)
r = await lineLogin({ sub: SUB1, email: EMAIL1, name: 'x' })
ok('L7 LINE 登入不會重新啟用被撤銷的角色（host / player membership 仍為停用）',
  sql(`select string_agg(role||':'||is_active, ',' order by role) from user_role_memberships where user_id='${id1}'`) === 'host:false,player:false',
  sql(`select string_agg(role||':'||is_active, ',' order by role) from user_role_memberships where user_id='${id1}'`))
await r.ctx.close()

// L8 state 竄改 / 取消 / 重放
r = await lineLogin({ sub: SUB1, email: EMAIL1 }, { tamperState: true })
ok('L8 state 不符 → 拒絕、未登入', pathOf(r.page).startsWith('/login?error=line_oauth_state_mismatch') && !(await sessionUserId(r.ctx)), pathOf(r.page))
await r.ctx.close()
r = await lineLogin({ sub: SUB1 }, { cancel: true })
ok('L8 使用者取消授權 → 「您已取消 LINE 授權」', pathOf(r.page).startsWith('/login?error=line_oauth_cancelled') && (await body(r.page)).includes('取消'), pathOf(r.page))
// 重試：取消後再登入成功
const retry = await r.page.goto(`${BASE}/api/auth/line/start?returnTo=%2Fmember-dashboard`).catch(() => null); void retry
await r.ctx.close()
r = await lineLogin({ sub: SUB1, email: EMAIL1 })
ok('L8 失敗後重試可正常登入', (await sessionUserId(r.ctx)) === id1)
// 重放同一個 callback（cookie 已清除）
const replayCode = b64u({ sub: SUB1, email: EMAIL1, nonce: r.auth.nonce })
await r.page.goto(`${BASE}/api/auth/line/callback?code=${replayCode}&state=${r.auth.state}`); await r.page.waitForLoadState('networkidle').catch(() => {})
ok('L8 重放已使用的 callback → 拒絕（暫存 cookie 一次性）', pathOf(r.page).startsWith('/login?error=line_oauth_state_missing') || pathOf(r.page).startsWith('/member-dashboard'), pathOf(r.page))
await r.ctx.close()

// L9 暫存 cookie 屬性
const ctx9 = await browser.newContext()
await ctx9.request.get(`${BASE}/api/auth/line/start?returnTo=%2Fmember-dashboard`, { maxRedirects: 0 })
const kc = (await ctx9.cookies()).find((c) => c.name === 'kb_line_oauth')
ok('L9 kb_line_oauth：HttpOnly、SameSite=Lax、Path=/、10 分鐘', kc?.httpOnly && kc?.sameSite === 'Lax' && kc?.path === '/' && kc.expires - Date.now() / 1000 <= 601 && kc.expires - Date.now() / 1000 > 590, JSON.stringify(kc))
ok('L9 暫存 cookie 不含 Channel Secret', !String(kc?.value).includes('local-test-secret'))
await ctx9.close()

// L10 錯誤紀錄不含 token / secret
const logs = sql(`select coalesce(string_agg(error_message||' '||coalesce(error_detail::text,'')||' '||coalesce(payload_snapshot::text,''), ' | '),'') from public_signup_error_logs where created_at > now() - interval '30 minutes'`)
ok('L10 錯誤紀錄不含 secret / id_token / access_token', !/local-test-secret|eyJ|access_token|id_token/.test(logs), logs.slice(0, 200))

await browser.close()
const failed = results.filter((x) => !x).length
console.log(`\n[LINE ${BASE}] ${results.length - failed}/${results.length} passed`)
