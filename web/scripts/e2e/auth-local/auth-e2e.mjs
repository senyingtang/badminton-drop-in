// M6 Task B：隔離環境真實整合測試（本機 Supabase：真 GoTrue + ES256 + Email 確認開啟 + SMTP→Mailpit；真 Chrome）
// usage: node m6-local-auth-e2e.mjs <BASE>   e.g. http://localhost:3105 (Next) / http://localhost:8787 (vinext Worker)
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_URL || 'playwright-core')
import { execFileSync } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3105'
const API = 'http://127.0.0.1:56821'
const MAIL = 'http://127.0.0.1:56824'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d && !p ? ' — ' + d : ''}`) }
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_badminton-auth-iso', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function mailFor(to, subjectIncludes, since) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((x) => x.json())
    const m = (r.messages || []).find((x) => x.Subject.includes(subjectIncludes) && new Date(x.Created).getTime() >= since - 2000)
    if (m) {
      const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json())
      const href = (full.HTML.match(/href="([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&')
      return { subject: m.Subject, href }
    }
    await sleep(500)
  }
  return null
}
const mailCount = async (to) => ((await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((x) => x.json())).messages || []).length

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const newCtx = () => browser.newContext({ locale: 'zh-TW' })
const pathOf = (p) => { const u = new URL(p.url()); return u.pathname + u.search }
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ')
const settle = (p) => p.waitForLoadState('networkidle').catch(() => {})
const waitPath = (p, fn, t = 20000) => p.waitForURL((u) => fn(u.pathname, u), { timeout: t }).catch(() => {})
const sbCookie = async (ctx) => (await ctx.cookies()).find((c) => /^sb-.*-auth-token(\.0)?$/.test(c.name))

const run = Date.now()
const E1 = `e2e1+${run}@example.test`, E2 = `e2e2+${run}@example.test`, E3 = `e2e3+${run}@example.test`
const PW = 'Abcd1234', PW2 = 'Newpass99'
const RETURN = '/member-dashboard/dropins'

async function register(page, email, returnTo = RETURN) {
  await page.goto(`${BASE}/register?returnTo=${encodeURIComponent(returnTo)}`); await settle(page)
  await page.fill('#displayName', '整合測試'); await page.fill('#email', email)
  await page.fill('#password', PW); await page.fill('#confirmPassword', PW)
  await page.click('button[type=submit]')
  await page.getByText('請前往信箱驗證').waitFor({ timeout: 15000 }).catch(() => {})
}
async function login(page, email, pw, returnTo) {
  await page.goto(`${BASE}/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`); await settle(page)
  await page.fill('#email', email); await page.fill('#password', pw); await page.click('button[type=submit]')
  await page.waitForTimeout(2500); await settle(page)
}

// ===== 1. Email 註冊 → 收信 → 驗證 → 登入（同一瀏覽器，自訂範本 {{ .RedirectTo }} + token_hash）=====
const c1 = await newCtx(); const p1 = await c1.newPage()
let t0 = Date.now()
await register(p1, E1)
ok('1 註冊後顯示「請前往信箱驗證」', (await body(p1)).includes('請前往信箱驗證'))
ok('1 尚未驗證不會登入（無 session cookie）', !(await sbCookie(c1)))
const m1 = await mailFor(E1, '確認', t0)
ok('1 真的收到驗證信（SMTP → Mailpit）', !!m1?.href, JSON.stringify(m1))
const l1 = m1?.href ? new URL(m1.href) : null
ok('1 驗證連結指向目前網域 /auth/confirm（不是 Site URL / Vercel / localhost:3999）', l1?.origin === new URL(BASE).origin && l1?.pathname === '/auth/confirm', m1?.href)
ok('1 OTP type = email、含 token_hash', l1?.searchParams.get('type') === 'email' && !!l1?.searchParams.get('token_hash'))
await login(p1, E1, PW)
ok('1 驗證前登入 → 「尚未完成信箱驗證」', (await body(p1)).includes('尚未完成信箱驗證'), (await body(p1)).slice(0, 150))
await p1.goto(m1.href); await waitPath(p1, (pth) => pth === RETURN); await settle(p1)
ok('1 點驗證連結 → 已登入並回到原頁 returnTo', pathOf(p1) === RETURN, pathOf(p1))
ok('1 驗證後網址不留 token_hash', !p1.url().includes('token_hash'))
const u1 = sql(`select id from auth.users where email='${E1}'`)
ok('1 Auth 使用者 email 已驗證', sql(`select email_confirmed_at is not null from auth.users where id='${u1}'`) === 't')
await sleep(1500)
ok('1 自動建立 profile（player、啟用）', sql(`select primary_role||'/'||coalesce(is_active,true) from app_user_profiles where id='${u1}'`) === 'player/true',
  sql(`select primary_role||'/'||coalesce(is_active,true) from app_user_profiles where id='${u1}'`))
ok('1 只有一個 Auth 帳號 / 一個 profile', sql(`select count(*) from auth.users where email='${E1}'`) === '1' && sql(`select count(*) from app_user_profiles where id='${u1}'`) === '1')
await p1.goto(m1.href); await settle(p1); await p1.waitForTimeout(1500)
ok('1 已登入時重複點同一連結 → 不出錯、仍登入', !pathOf(p1).startsWith('/login'), pathOf(p1))
const cx = await newCtx(); const px = await cx.newPage()
await px.goto(m1.href); await waitPath(px, (pth) => pth === '/login'); await settle(px)
ok('1 已用過的連結在別的瀏覽器 → 「連結已失效」', pathOf(px).startsWith('/login?error=link_invalid') && (await body(px)).includes('連結已失效'), pathOf(px))
await cx.close()

// ===== 2. 重複註冊：不枚舉 =====
const c2 = await newCtx(); const p2 = await c2.newPage()
const before = await mailCount(E1)
await register(p2, E1)
ok('2 已註冊 email 再註冊 → 同樣顯示「請前往信箱驗證」（不透露帳號存在）', (await body(p2)).includes('請前往信箱驗證'))
ok('2 不會建立第二個帳號', sql(`select count(*) from auth.users where email='${E1}'`) === '1')
await c2.close()
void before

// ===== 3. 跨裝置：A 瀏覽器註冊、B 瀏覽器開信 =====
const c3a = await newCtx(); const p3a = await c3a.newPage(); t0 = Date.now()
await register(p3a, E2)
const m2 = await mailFor(E2, '確認', t0)
const c3b = await newCtx(); const p3b = await c3b.newPage()
await p3b.goto(m2.href); await waitPath(p3b, (pth) => pth.startsWith('/member-dashboard')); await settle(p3b)
ok('3 在另一個瀏覽器開驗證信 → 驗證成功並登入（token_hash 不需 PKCE）', pathOf(p3b).startsWith('/member-dashboard'), pathOf(p3b))
await c3a.close(); await c3b.close()

// ===== 4. 預設範本路徑（ConfirmationURL → /verify → ?code，PKCE）與白名單 =====
const c4 = await newCtx(); const p4 = await c4.newPage(); t0 = Date.now()
await register(p4, E3)
const m3 = await mailFor(E3, '確認', t0)
const th = new URL(m3.href).searchParams.get('token_hash')
const verifyUrl = `${API}/auth/v1/verify?token=${th}&type=signup&redirect_to=${encodeURIComponent(`${BASE}/auth/confirm`)}`
const vr = await fetch(verifyUrl, { redirect: 'manual' })
const vloc = vr.headers.get('location') || ''
ok('4 預設範本：/verify 導回 目前網域/auth/confirm?code=', vloc.startsWith(`${BASE}/auth/confirm?code=`), vloc)
await p4.goto(vloc); await waitPath(p4, (pth) => pth.startsWith('/member-dashboard')); await settle(p4)
ok('4 預設範本 + 同一瀏覽器（PKCE）→ 登入並回 returnTo', pathOf(p4) === RETURN, pathOf(p4))
const bad = await fetch(`${API}/auth/v1/verify?token=x&type=signup&redirect_to=${encodeURIComponent('https://not-allowed.example/auth/confirm')}`, { redirect: 'manual' })
ok('4 redirectTo 不在白名單 → Supabase 改導 Site URL（證明必須設定 Redirect URLs）', (bad.headers.get('location') || '').startsWith('http://localhost:3999'), bad.headers.get('location'))
const rootFallback = await fetch(`${BASE}/?code=abc&x=1`, { redirect: 'manual' })
ok('4 Site URL 根路徑收到 ?code → 轉交 /auth/confirm', (rootFallback.headers.get('location') || '').includes('/auth/confirm?code=abc'), rootFallback.headers.get('location'))
await c4.close()

// ===== 5. Session：Cookie、F5、真 refresh、多分頁 =====
const ck = await sbCookie(c1)
ok('5 session cookie：SameSite=Lax、Path=/、host-only', ck?.sameSite === 'Lax' && ck?.path === '/' && !ck?.domain.startsWith('.'), JSON.stringify(ck && { s: ck.sameSite, d: ck.domain, secure: ck.secure }))
await p1.goto(`${BASE}${RETURN}`); await settle(p1); await p1.reload(); await settle(p1)
ok('5 F5 後仍登入', pathOf(p1) === RETURN, pathOf(p1))
// 把 cookie 內 expires_at 改成過去 → 迫使 middleware 用真 refresh_token 向 GoTrue 換新 token
const decode = (v) => JSON.parse(Buffer.from(v.replace(/^base64-/, ''), 'base64url').toString())
const encode = (o) => 'base64-' + Buffer.from(JSON.stringify(o)).toString('base64url')
const allSb = (await c1.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
const sess = decode(allSb.map((c) => c.value).join(''))
const oldRefresh = sess.refresh_token, oldAccess = sess.access_token
sess.expires_at = Math.floor(Date.now() / 1000) - 10
await c1.clearCookies({ name: allSb[0].name }); for (const c of allSb.slice(1)) await c1.clearCookies({ name: c.name })
await c1.addCookies([{ ...allSb[0], name: allSb[0].name.replace(/\.\d+$/, ''), value: encode(sess) }])
await p1.goto(`${BASE}${RETURN}`); await settle(p1)
const after = (await c1.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
const sess2 = after.length ? decode(after.map((c) => c.value).join('')) : null
ok('5 token 到期 → 真的向 GoTrue refresh（refresh token 輪替、access token 更新）', !!sess2 && sess2.refresh_token !== oldRefresh && sess2.access_token !== oldAccess, sess2 ? 'same tokens' : 'no cookie')
ok('5 refresh 後仍在原頁、未被登出', pathOf(p1) === RETURN, pathOf(p1))
const p1b = await c1.newPage(); await p1b.goto(`${BASE}/member-dashboard`); await settle(p1b)
ok('5 第二分頁共用 session', new URL(p1b.url()).pathname === '/member-dashboard'); await p1b.close()

// ===== 6. 角色導向 / 停權 / 刪除（真資料庫狀態）=====
sql(`update app_user_profiles set primary_role='host' where id='${u1}'`)
await p1.goto(`${BASE}/login`); await settle(p1)
ok('6 host 開 /login → /dashboard', pathOf(p1) === '/dashboard', pathOf(p1))
await p1.goto(`${BASE}/sessions`); await settle(p1)
ok('6 host 可進管理頁 /sessions', pathOf(p1) === '/sessions', pathOf(p1))
sql(`update app_user_profiles set primary_role='player' where id='${u1}'`)
await p1.goto(`${BASE}/dashboard`); await settle(p1)
ok('6 player 進 /dashboard → /member-dashboard', pathOf(p1) === '/member-dashboard', pathOf(p1))
sql(`update app_user_profiles set is_active=false where id='${u1}'`)
await p1.goto(`${BASE}/member-dashboard`); await settle(p1)
ok('6 停權 → 立即登出並顯示停權', pathOf(p1) === '/login?reason=account_suspended' && (await body(p1)).includes('已停權'), pathOf(p1))
ok('6 停權後 session cookie 已清除', !(await sbCookie(c1)))
await login(p1, E1, PW)
ok('6 停權帳號登入被拒（伺服端）', (await body(p1)).includes('已停權') && !(await sbCookie(c1)), pathOf(p1))
sql(`update app_user_profiles set is_active=true, is_deleted=true where id='${u1}'`)
await login(p1, E1, PW)
ok('6 已刪除帳號登入被拒', (await body(p1)).includes('已刪除') && !(await sbCookie(c1)))
sql(`update app_user_profiles set is_deleted=false where id='${u1}'`)

// ===== 7. 密碼登入 / 錯誤 =====
await login(p1, E1, 'Wrong1234')
ok('7 錯誤密碼 → 中文訊息、無 session', (await body(p1)).includes('電子郵件或密碼不正確') && !(await sbCookie(c1)))
await login(p1, `nobody+${run}@example.test`, 'Wrong1234')
ok('7 不存在帳號 → 與錯誤密碼同訊息（不枚舉）', (await body(p1)).includes('電子郵件或密碼不正確'))
await login(p1, E1, PW, '/s/NOPE')
ok('7 正確密碼 → 回到 returnTo（場次報名頁）', pathOf(p1) === '/s/NOPE', pathOf(p1))

// ===== 8. 登出 =====
const preLogout = decode((await c1.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join(''))
await p1.goto(`${BASE}/member-dashboard`); await settle(p1)
await p1.locator('button', { hasText: '登出' }).first().click(); await waitPath(p1, (pth) => pth === '/login'); await settle(p1)
ok('8 登出 → /login、cookie 清除', pathOf(p1).startsWith('/login') && !(await sbCookie(c1)), pathOf(p1))
await p1.goto(`${BASE}/member-dashboard`); await settle(p1)
ok('8 登出後無法進受保護頁', pathOf(p1).startsWith('/login?returnTo='), pathOf(p1))
const reuse = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: preLogout.refresh_token }) })
ok('8 登出後舊 refresh token 在 GoTrue 端已失效', reuse.status === 400, `HTTP ${reuse.status}`)
const userCall = await fetch(`${API}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${preLogout.access_token}` } })
ok('8 登出後舊 access token 呼叫 /auth/v1/user 被拒（session 已撤銷）', userCall.status === 403 || userCall.status === 401, `HTTP ${userCall.status}`)

// ===== 9. 忘記密碼 → 收信 → 重設 → 登入 =====
t0 = Date.now()
await p1.goto(`${BASE}/forgot-password`); await settle(p1)
await p1.fill('#email', E1); await p1.click('button[type=submit]'); await p1.waitForTimeout(2000)
ok('9 送出重設 → 顯示「若此 email 已註冊」', (await body(p1)).includes('若此 email 已註冊'))
const m4 = await mailFor(E1, '重設', t0)
const l4 = m4?.href ? new URL(m4.href) : null
ok('9 收到重設信，連結回目前網域 /auth/confirm、type=recovery', l4?.origin === new URL(BASE).origin && l4?.pathname === '/auth/confirm' && l4?.searchParams.get('type') === 'recovery', m4?.href)
await p1.goto(m4.href); await waitPath(p1, (pth) => pth === '/reset-password'); await settle(p1)
ok('9 點重設連結 → /reset-password', pathOf(p1) === '/reset-password', pathOf(p1))
await p1.fill('#password', '12345678'); await p1.fill('#confirm', '12345678'); await p1.click('button[type=submit]'); await p1.waitForTimeout(800)
ok('9 新密碼不合規則被擋', (await body(p1)).includes('英文字母與數字'))
await p1.fill('#password', PW2); await p1.fill('#confirm', PW2); await p1.click('button[type=submit]')
await waitPath(p1, (pth) => pth === '/login'); await settle(p1)
ok('9 更新成功 → /login?reason=password_updated', pathOf(p1) === '/login?reason=password_updated' && (await body(p1)).includes('密碼已更新'), pathOf(p1))
await login(p1, E1, PW)
ok('9 舊密碼不能登入', (await body(p1)).includes('電子郵件或密碼不正確'))
await login(p1, E1, PW2, RETURN)
ok('9 新密碼可登入', pathOf(p1) === RETURN, pathOf(p1))
const cy = await newCtx(); const py = await cy.newPage()
await py.goto(m4.href); await waitPath(py, (pth) => pth === '/forgot-password'); await settle(py)
ok('9 重設連結重複使用 → 忘記密碼頁「連結已失效」', pathOf(py) === '/forgot-password?error=link_invalid', pathOf(py))
await cy.close()
const nobody = `ghost+${run}@example.test`; t0 = Date.now()
await p1.goto(`${BASE}/forgot-password`); await settle(p1)
await p1.fill('#email', nobody); await p1.click('button[type=submit]'); await p1.waitForTimeout(2500)
ok('9 不存在的 email 也顯示相同訊息、且不寄信', (await body(p1)).includes('若此 email 已註冊') && (await mailCount(nobody)) === 0)

// ===== 10. 預設範本的重設（code 流程，同一瀏覽器，靠本機記錄判斷為 recovery）=====
await c1.clearCookies()
t0 = Date.now()
await p1.goto(`${BASE}/forgot-password`); await settle(p1)
await p1.fill('#email', E1); await p1.click('button[type=submit]'); await p1.waitForTimeout(2000)
const m5 = await mailFor(E1, '重設', t0)
const th5 = new URL(m5.href).searchParams.get('token_hash')
const v5 = await fetch(`${API}/auth/v1/verify?token=${th5}&type=recovery&redirect_to=${encodeURIComponent(`${BASE}/auth/confirm`)}`, { redirect: 'manual' })
await p1.goto(v5.headers.get('location')); await waitPath(p1, (pth) => pth === '/reset-password'); await settle(p1)
ok('10 預設範本重設（?code）→ /reset-password', pathOf(p1) === '/reset-password', `${v5.headers.get('location')} → ${pathOf(p1)}`)

await browser.close()
const failed = results.filter((x) => !x).length
console.log(`\n[${BASE}] ${results.length - failed}/${results.length} passed`)
