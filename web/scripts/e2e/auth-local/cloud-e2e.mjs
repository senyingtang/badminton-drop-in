// M7：雲端 Staging 驗收（Cloudflare Worker + Staging Supabase + 真 Chrome）。不寄信的部分。
// 寄信相關：信件連結以 admin generateLink 產生（驗證「連結處理」），「寄送」需 SMTP，另行實測。
// usage: STAGING_SR_FILE=D:/project/secrets/staging-service-role.txt node cloud-e2e.mjs
import fs from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_URL || 'playwright-core')

const W = process.env.STAGING_URL || 'https://badminton-drop-in-staging.senyingtang2025.workers.dev'
const SB = process.env.STAGING_SUPABASE_URL || 'https://cwvhxkujxsurvrmjexvm.supabase.co'
const SR = fs.readFileSync(process.env.STAGING_SR_FILE, 'utf8').trim()
if (SB.includes('ngudidpitcfyzmbphlgt')) throw new Error('refusing to run against production')
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d && !p ? ' — ' + d : ''}`) }
const H = { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json' }
const admin = (path, init = {}) => fetch(`${SB}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }))
const run = Date.now()
const PW = 'Abcd1234', PW2 = 'Newpass99'

async function mkUser(tag, role) {
  const email = `m7-${tag}+${run}@example.test`
  const { j } = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PW, email_confirm: true }) })
  await admin('/rest/v1/app_user_profiles', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: j.id, display_name: `M7 ${tag}`, primary_role: role }) })
  return { id: j.id, email }
}
const setProfile = (id, patch) => admin(`/rest/v1/app_user_profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const pathOf = (p) => { const u = new URL(p.url()); return u.pathname + u.search }
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ')
const settle = (p) => p.waitForLoadState('networkidle').catch(() => {})
const waitPath = (p, fn, t = 20000) => p.waitForURL((u) => fn(u.pathname, u), { timeout: t }).catch(() => {})
const sbParts = async (ctx) => (await ctx.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
const decode = (v) => JSON.parse(Buffer.from(v.replace(/^base64-/, ''), 'base64url').toString())
const encode = (o) => 'base64-' + Buffer.from(JSON.stringify(o)).toString('base64url')
const statuses = []
async function login(page, email, pw, returnTo) {
  await page.goto(`${W}/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`); await settle(page)
  await page.fill('#email', email); await page.fill('#password', pw); await page.click('button[type=submit]')
  await page.waitForTimeout(3000); await settle(page)
}

const player = await mkUser('player', 'player')
const host = await mkUser('host', 'host')
const ctx = await browser.newContext({ locale: 'zh-TW' }); const page = await ctx.newPage()
page.on('response', (r) => { if (r.url().startsWith(W)) statuses.push(r.status()) })

// C1 密碼登入
await login(page, player.email, 'Wrong1234')
ok('C1 錯誤密碼 → 中文訊息、未登入', (await body(page)).includes('電子郵件或密碼不正確') && !(await sbParts(ctx)).length)
await login(page, player.email, PW, '/s/ABCD')
ok('C1 正確密碼 → 回到報名頁 returnTo', pathOf(page) === '/s/ABCD', pathOf(page))
const ck = (await sbParts(ctx))[0]
ok('C1 session cookie：Secure、SameSite=Lax、host-only', ck?.secure && ck?.sameSite === 'Lax' && !ck?.domain.startsWith('.'), JSON.stringify(ck && { secure: ck.secure, s: ck.sameSite, d: ck.domain }))

// C2 F5 / 多分頁 / 角色導向
await page.goto(`${W}/member-dashboard`); await settle(page); await page.reload(); await settle(page)
ok('C2 F5 後仍登入', pathOf(page) === '/member-dashboard', pathOf(page))
await page.goto(`${W}/dashboard`); await settle(page)
ok('C2 球友進 /dashboard → /member-dashboard', pathOf(page) === '/member-dashboard', pathOf(page))
const p2 = await ctx.newPage(); await p2.goto(`${W}/member-dashboard/dropins`); await settle(p2)
ok('C2 第二分頁共用 session', new URL(p2.url()).pathname === '/member-dashboard/dropins'); await p2.close()

// C3 真實 refresh（雲端 GoTrue）
const parts = await sbParts(ctx); const sess = decode(parts.map((c) => c.value).join(''))
const oldR = sess.refresh_token, oldA = sess.access_token
sess.expires_at = Math.floor(Date.now() / 1000) - 10
for (const c of parts) await ctx.clearCookies({ name: c.name })
await ctx.addCookies([{ ...parts[0], name: parts[0].name.replace(/\.\d+$/, ''), value: encode(sess) }])
await page.goto(`${W}/member-dashboard`); await settle(page)
const s2 = decode((await sbParts(ctx)).map((c) => c.value).join('') || 'base64-e30')
ok('C3 token 到期 → Worker 向 Staging Supabase refresh（token 輪替）', s2.refresh_token && s2.refresh_token !== oldR && s2.access_token !== oldA)
ok('C3 refresh 後仍在原頁', pathOf(page) === '/member-dashboard', pathOf(page))

// C4 登出
const pre = decode((await sbParts(ctx)).map((c) => c.value).join(''))
await page.locator('button', { hasText: '登出' }).first().click(); await waitPath(page, (p) => p === '/login'); await settle(page)
ok('C4 登出 → /login、cookie 清除', pathOf(page).startsWith('/login') && !(await sbParts(ctx)).length, pathOf(page))
await page.goto(`${W}/member-dashboard`); await settle(page)
ok('C4 登出後無法進受保護頁', pathOf(page).startsWith('/login?returnTo='), pathOf(page))
const reuse = await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: SR, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: pre.refresh_token }) })
ok('C4 舊 refresh token 已失效', reuse.status === 400, `HTTP ${reuse.status}`)

// C5 團主：無登入循環、無 504
const t0 = Date.now()
await login(page, host.email, PW)
ok('C5 團主登入 → /dashboard（無循環）', pathOf(page) === '/dashboard', pathOf(page))
for (const p of ['/sessions', '/players', '/venues', '/billing', '/settings', '/login', '/register']) {
  await page.goto(`${W}${p}`); await settle(page)
}
ok('C5 團主瀏覽管理頁：留在管理區、未被導去會員中心', pathOf(page) === '/dashboard', pathOf(page))
ok(`C5 全程無 5xx / 504（${statuses.length} 個回應，${Math.round((Date.now() - t0) / 1000)}s）`, !statuses.some((s) => s >= 500), statuses.filter((s) => s >= 500).join(','))

// C6 停權 / 刪除
await setProfile(host.id, { is_active: false })
await page.goto(`${W}/dashboard`); await settle(page)
ok('C6 停權 → 立即登出、顯示停權', pathOf(page) === '/login?reason=account_suspended' && !(await sbParts(ctx)).length, pathOf(page))
await login(page, host.email, PW)
ok('C6 停權帳號登入被拒', (await body(page)).includes('已停權') && !(await sbParts(ctx)).length)
await setProfile(host.id, { is_active: true, is_deleted: true })
await login(page, host.email, PW)
ok('C6 已刪除帳號登入被拒', (await body(page)).includes('已刪除') && !(await sbParts(ctx)).length)

// C7 重設密碼連結（admin 產生；寄送另測）
const gl = await admin('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'recovery', email: player.email, redirect_to: `${W}/auth/confirm` }) })
const th = gl.j?.hashed_token || gl.j?.properties?.hashed_token
const c7 = await browser.newContext({ locale: 'zh-TW' }); const p7 = await c7.newPage()
await p7.goto(`${W}/auth/confirm?token_hash=${th}&type=recovery`); await waitPath(p7, (p) => p === '/reset-password'); await settle(p7)
ok('C7 重設連結（範本格式 token_hash）→ /reset-password', pathOf(p7) === '/reset-password', pathOf(p7))
await p7.fill('#password', PW2); await p7.fill('#confirm', PW2); await p7.click('button[type=submit]')
await waitPath(p7, (p) => p === '/login'); await settle(p7)
ok('C7 更新密碼 → /login?reason=password_updated', pathOf(p7) === '/login?reason=password_updated', pathOf(p7))
await login(p7, player.email, PW)
ok('C7 舊密碼失效', (await body(p7)).includes('電子郵件或密碼不正確'))
await login(p7, player.email, PW2, '/member-dashboard')
ok('C7 新密碼登入', pathOf(p7) === '/member-dashboard', pathOf(p7))
await c7.close()
const gl2 = await admin('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'recovery', email: player.email, redirect_to: `${W}/auth/confirm` }) })
ok('C7 redirect_to 在白名單內（Staging 回到 Worker 網域，不是 localhost / Vercel）', String(gl2.j?.redirect_to || gl2.j?.properties?.redirect_to).startsWith(W), JSON.stringify(gl2.j?.properties?.redirect_to || gl2.j?.redirect_to))

// C8 註冊驗證連結（admin 產生；寄送另測）
const email8 = `m7-signup+${run}@example.test`
const gl3 = await admin('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'signup', email: email8, password: PW, redirect_to: `${W}/auth/confirm` }) })
const th3 = gl3.j?.hashed_token || gl3.j?.properties?.hashed_token
const c8 = await browser.newContext({ locale: 'zh-TW' }); const p8 = await c8.newPage()
await p8.goto(`${W}/auth/confirm?token_hash=${th3}&type=email`); await waitPath(p8, (p) => p.startsWith('/member-dashboard')); await settle(p8)
ok('C8 驗證連結 → 驗證並登入（另一個瀏覽器也可）', pathOf(p8).startsWith('/member-dashboard'), pathOf(p8))
await p8.waitForTimeout(2000)
const prof = await admin(`/rest/v1/app_user_profiles?select=primary_role,is_active&id=eq.${gl3.j?.id || gl3.j?.user?.id}`)
ok('C8 首次登入自動建立 player profile', prof.j?.[0]?.primary_role === 'player', JSON.stringify(prof.j))
await c8.close()

await browser.close()
const failed = results.filter((x) => !x).length
console.log(`\n[CLOUD ${W}] ${results.length - failed}/${results.length} passed`)
