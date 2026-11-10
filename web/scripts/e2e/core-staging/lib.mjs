// M8：Staging 核心寫入驗收（真 Chrome 操作 Staging Worker 的團主／球友 UI）。只連 Staging。
// 在輸出資料夾（cwd）執行；依序：s1 s2 s4 s5 s6 s8 check7 s10 s11 s12 s13 s14。需 PLAYWRIGHT_CORE_URL、系統 Chrome。
import fs from 'node:fs'
export const { chromium } = await import(process.env.PLAYWRIGHT_CORE_URL || 'playwright-core')
export const W = 'https://badminton-drop-in-staging.senyingtang2025.workers.dev'
export const SB = 'https://cwvhxkujxsurvrmjexvm.supabase.co'
export const SR = fs.readFileSync(process.env.STAGING_SR_FILE || 'D:/project/secrets/staging-service-role.txt', 'utf8').trim()
if (SB.includes('ngudidpitcfyzmbphlgt')) throw new Error('refusing to run against production')
export const DIR = process.env.M8_OUT_DIR || process.cwd()  // state.json / *-state.json / 截圖（含 session cookie，勿提交）
const H = { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json' }
export const admin = (path, init = {}) => fetch(`${SB}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }))
export const PW = 'Abcd1234'
export const STATE = DIR + '/state.json'
export const load = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {})
export const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
export async function mkUser(tag, role, name) {
  const email = `m8-${tag}@example.test`
  let { j } = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PW, email_confirm: true }) })
  if (!j?.id) throw new Error('mkUser ' + JSON.stringify(j))
  await admin('/rest/v1/app_user_profiles', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: j.id, display_name: name, primary_role: role }) })
  await admin('/rest/v1/user_role_memberships', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ user_id: j.id, role, is_active: true }) })
  return { id: j.id, email, name }
}
export const results = []
export const ok = (n, p, d = '') => { results.push([n, p]); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`) }
export async function browserCtx(b) { const ctx = await b.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', viewport: { width: 1400, height: 1000 } }); return ctx }
export async function login(page, email) {
  await page.goto(`${W}/login`); await page.waitForLoadState('networkidle').catch(() => {})
  await page.fill('#email', email); await page.fill('#password', PW); await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
}
export const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ')
export const shot = (p, n) => p.screenshot({ path: `${DIR}/${n}.png`, fullPage: true })
export const settle = async (p, ms = 1500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
