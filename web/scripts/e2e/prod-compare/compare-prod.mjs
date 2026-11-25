// 正式 Worker 部署後唯讀比對：同一時間點比較「正式 Supabase」、「舊版 Vercel」與「新版 Worker」。
// 只做讀取：Supabase 走 `supabase db query --read-only`；兩個網站只送 GET。不輸出姓名 / Email / 分享碼。
//
// 步驟：
//   T0  資料庫指紋（10 類：場次、開放報名、日期時間場地、正選 / 候補、錢包餘額、錢包交易、已繳費、營運報表、排組比分、LINE 重複）
//   A   Worker 閘門：未帶密碼必須 401 / 503（切換前不可對外）
//   B   所有場次的公開名單 /api/public/session-roster?code=…：Vercel 與 Worker 同時請求，內容必須完全相同
//   C   （選用）登入後 API：營運總覽 / 報表 / 開放臨打。兩邊帶同一個 Supabase 登入 Cookie，內容必須相同
//   T1  再取一次資料庫指紋；與 T0 不同代表比對期間有人寫入 → 結果無效，請重跑
//
// 用法（D:\project\badminton\web）：
//   node scripts/e2e/prod-compare/compare-prod.mjs --gate-password-file D:\project\secrets\prod-gate-password.txt
//     [--auth-cookie-file D:\project\secrets\compare-auth-cookie.txt]   # 檔案內容：瀏覽器 Vercel 網站的整段 Cookie 標頭值（含 sb-ngudidpitcfyzmbphlgt-auth-token…）
//     [--worker https://badminton-drop-in-prod.senyingtang2025.workers.dev] [--vercel https://badminton-drop-in.vercel.app]
// 結束碼：0 = PASS，1 = FAIL。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const REF = 'ngudidpitcfyzmbphlgt'
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
const WORKER = (args.worker || 'https://badminton-drop-in-prod.senyingtang2025.workers.dev').replace(/\/$/, '')
const VERCEL = (args.vercel || 'https://badminton-drop-in.vercel.app').replace(/\/$/, '')
const WEB_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..')

const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }
const readSecret = (f) => (f ? fs.readFileSync(f, 'utf8').trim() : '')
const PRECHECK = process.argv.includes('--precheck') // 部署前：只跑資料庫指紋與 Vercel 端，不連 Worker
const gatePassword = readSecret(args['gate-password-file'])
const authCookie = readSecret(args['auth-cookie-file'])
if (!PRECHECK && gatePassword.length < 16) { console.error('FAIL  --gate-password-file is required (>= 16 chars)'); process.exit(1) }
const workerAuth = 'Basic ' + Buffer.from(`compare:${gatePassword}`).toString('base64')

// ---------- Supabase read-only ----------
function dbQuery(sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodcmp-'))
  const file = path.join(dir, 'q.sql')
  fs.writeFileSync(file, sql, 'utf8')
  try {
    const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', 'supabase', 'db', 'query', `--remote=${REF}`, '--read-only', '--output-format', 'json', '-f', file],
      { cwd: WEB_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    const doc = JSON.parse(out.trim()) // human mode: array; agent mode: { rows }
    if (Array.isArray(doc)) return doc
    if (doc && Array.isArray(doc.rows)) return doc.rows
    throw new Error(`unexpected CLI output: ${JSON.stringify(doc).slice(0, 200)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const FINGERPRINT_SQL = `
select
 (select jsonb_build_object('n', count(*), 'md5', md5(coalesce(string_agg(concat_ws('|', id, status, court_count, max_participants, min_participants, fee_twd, allow_self_signup, share_signup_code, assignment_mode), ',' order by id), ''))) from public.sessions) as sessions,
 (select jsonb_build_object('n', count(*), 'md5', md5(coalesce(string_agg(id::text, ',' order by id), ''))) from public.sessions where status = 'registration_open') as open_sessions,
 (select jsonb_build_object('n', count(*), 'md5', md5(coalesce(string_agg(concat_ws('|', s.id, s.start_at, s.end_at, s.venue_id, v.name, v.full_address, v.address_text), ',' order by s.id), ''))) from public.sessions s left join public.venues v on v.id = s.venue_id) as schedule_venue,
 (select jsonb_build_object('n', count(*), 'waitlist', count(*) filter (where status::text = 'waitlist'), 'removed', count(*) filter (where is_removed),
    'md5', md5(coalesce(string_agg(concat_ws('|', id, session_id, status, priority_order, waitlist_order, is_removed), ',' order by id), ''))) from public.session_participants) as roster,
 (select jsonb_build_object('n', count(*), 'sum_cents', coalesce(sum(balance_cents), 0), 'md5', md5(coalesce(string_agg(concat_ws('|', id, balance_cents), ',' order by id), ''))) from public.kb_wallets) as wallets,
 (select jsonb_build_object('n', count(*), 'sum_cents', coalesce(sum(amount_cents), 0), 'md5', md5(coalesce(string_agg(concat_ws('|', id, wallet_id, amount_cents, direction, balance_after), ',' order by id), ''))) from public.kb_wallet_transactions) as wallet_txns,
 (select jsonb_build_object('paid', count(*) filter (where paid_at is not null), 'md5', md5(coalesce(string_agg(concat_ws('|', id, paid_at), ',' order by id), ''))) from public.session_participants) as paid,
 (select jsonb_build_object('n', count(*), 'gross_cents', coalesce(sum(gross_revenue_cents), 0), 'net_cents', coalesce(sum(net_revenue_cents), 0),
    'expense_cents', coalesce(sum(coalesce(shuttlecock_cost_cents, 0) + coalesce(other_expense_cents, 0) + coalesce(venue_cost_cents, 0)), 0),
    'md5', md5(coalesce(string_agg(concat_ws('|', id, actual_fee_cents, gross_revenue_cents, net_revenue_cents, shuttlecock_cost_cents, other_income_cents, other_expense_cents, venue_cost_cents), ',' order by id), '')))
    from public.session_operation_reports where deleted_at is null) as reports,
 (select jsonb_build_object('rounds', (select count(*) from public.rounds), 'matches', count(*),
    'md5', md5(coalesce(string_agg(concat_ws('|', m.id, m.round_id, r.round_no, r.status, m.court_no, m.final_score_team_1, m.final_score_team_2, m.winning_team_no), ',' order by m.id), '')))
    from public.matches m join public.rounds r on r.id = m.round_id) as history,
 (select jsonb_build_object('duplicates', count(*)) from (select line_user_id from public.players where line_user_id is not null group by 1 having count(*) > 1) d) as line_bindings`

const shareCodesSql = `select share_signup_code as code from public.sessions where share_signup_code is not null and share_signup_code <> '' order by start_at desc`

// ---------- HTTP (GET only) ----------
async function get(base, p, { worker = false, cookie = '' } = {}) {
  const headers = { 'user-agent': 'prod-readonly-compare', accept: 'application/json' }
  if (worker) headers.authorization = workerAuth
  if (cookie) headers.cookie = cookie
  const res = await fetch(base + p, { method: 'GET', headers, redirect: 'manual' })
  const body = await res.text()
  return { status: res.status, body }
}
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)
const digest = (body) => { try { return crypto.createHash('sha256').update(JSON.stringify(canon(JSON.parse(body)))).digest('hex') } catch { return 'non-json:' + crypto.createHash('sha256').update(body).digest('hex') } }

// ---------- run ----------
console.log(`Worker: ${WORKER}\nVercel: ${VERCEL}\nSupabase: ${REF} (read-only)\n`)
const t0 = dbQuery(FINGERPRINT_SQL)[0]
console.log('T0 fingerprint:')
for (const [k, v] of Object.entries(t0)) console.log(`  ${k.padEnd(15)} ${JSON.stringify(v)}`)
ok('LINE bindings: no duplicates', t0.line_bindings.duplicates === 0, `duplicates=${t0.line_bindings.duplicates}`)

if (PRECHECK) {
  const codes = dbQuery(shareCodesSql).map((r) => r.code)
  let okCount = 0
  for (const code of codes) { const v = await get(VERCEL, `/api/public/session-roster?code=${encodeURIComponent(code)}`); if (v.status === 200 && !digest(v.body).startsWith('non-json')) okCount++ }
  ok('precheck: Vercel serves every public roster as JSON', codes.length > 0 && okCount === codes.length, `sessions=${codes.length} ok=${okCount}`)
  const t1p = dbQuery(FINGERPRINT_SQL)[0]
  const ch = Object.keys(t0).filter((k) => JSON.stringify(t0[k]) !== JSON.stringify(t1p[k]))
  ok('precheck: database unchanged (T0 == T1)', ch.length === 0, ch.join(', '))
  const f = results.filter((x) => !x).length
  console.log(`\n${results.length - f}/${results.length} passed\n${f ? 'PRECHECK FAIL' : 'PRECHECK PASS'}`)
  process.exit(f ? 1 : 0)
}

// A) gate
for (const p of ['/', '/api/public/session-roster?code=x', '/api/line/webhook']) {
  const r = await fetch(WORKER + p, { method: 'GET', redirect: 'manual' })
  ok(`Worker gate locked without password: ${p}`, r.status === 401 || r.status === 503, `status=${r.status}`)
}
const ver = await get(WORKER, '/api/version', { worker: true })
ok('Worker reachable with gate password', ver.status === 200, `status=${ver.status}`)

// B) public rosters, Vercel vs Worker at the same moment
const codes = dbQuery(shareCodesSql).map((r) => r.code)
let same = 0, diff = 0, errors = 0
for (const code of codes) {
  const q = `/api/public/session-roster?code=${encodeURIComponent(code)}`
  const [v, w] = await Promise.all([get(VERCEL, q), get(WORKER, q, { worker: true })])
  if (v.status !== w.status) { diff++; console.log(`  status differs for session #${same + diff + errors}: vercel=${v.status} worker=${w.status}`); continue }
  if (v.status >= 500) { errors++; continue }
  if (digest(v.body) === digest(w.body)) same++; else { diff++; console.log(`  roster content differs for session #${same + diff + errors} (status ${v.status})`) }
}
ok(`public session rosters identical (Vercel vs Worker)`, codes.length > 0 && diff === 0 && errors === 0, `sessions=${codes.length} same=${same} diff=${diff} errors=${errors}`)

// C) authenticated APIs (optional)
if (authCookie) {
  for (const p of ['/api/auth/whoami', '/api/dashboard/operations/summary?range=all', '/api/dashboard/operations/reports', '/api/member/dropins/open']) {
    const [v, w] = await Promise.all([get(VERCEL, p, { cookie: authCookie }), get(WORKER, p, { worker: true, cookie: authCookie })])
    const pass = v.status === w.status && v.status === 200 && digest(v.body) === digest(w.body)
    ok(`authenticated ${p.split('?')[0]} identical`, pass, `vercel=${v.status} worker=${w.status}`)
  }
} else {
  console.log('SKIP  authenticated API comparison (no --auth-cookie-file)')
}

// T1: nothing may change while comparing
const t1 = dbQuery(FINGERPRINT_SQL)[0]
const changed = Object.keys(t0).filter((k) => JSON.stringify(t0[k]) !== JSON.stringify(t1[k]))
ok('database unchanged during comparison (T0 == T1)', changed.length === 0, changed.length ? `changed: ${changed.join(', ')} — rerun when idle` : '')

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
console.log(failed ? 'PROD COMPARE FAIL' : 'PROD COMPARE PASS')
process.exit(failed ? 1 : 0)
