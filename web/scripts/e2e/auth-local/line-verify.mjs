// M7.2：真實 LINE 登入後的資料檢查（Staging）。只讀，不修改資料；不輸出 token / secret / email 全文。
// usage: STAGING_SR_FILE=D:/project/secrets/staging-service-role.txt node line-verify.mjs
import fs from 'node:fs'

const SB = process.env.STAGING_SUPABASE_URL || 'https://cwvhxkujxsurvrmjexvm.supabase.co'
if (SB.includes('ngudidpitcfyzmbphlgt')) throw new Error('refusing to run against production')
const SR = fs.readFileSync(process.env.STAGING_SR_FILE, 'utf8').trim()
const H = { apikey: SR, authorization: `Bearer ${SR}` }
const get = async (p) => (await fetch(`${SB}${p}`, { headers: H })).json()
const mask = (e) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1***$2') : e)
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`) }

const users = []
for (let page = 1; ; page++) {
  const j = await get(`/auth/v1/admin/users?page=${page}&per_page=200`)
  users.push(...(j.users || []))
  if (!j.users || j.users.length < 200) break
}
const lineUsers = users.filter((u) => u.app_metadata?.line_sub || u.user_metadata?.line_sub)
console.log(`auth users: ${users.length} total, ${lineUsers.length} created via LINE`)

const players = await get('/rest/v1/players?select=id,auth_user_id,line_user_id&line_user_id=not.is.null')
const subs = new Map()
for (const u of lineUsers) {
  const sub = u.app_metadata?.line_sub || u.user_metadata?.line_sub
  subs.set(sub, (subs.get(sub) || 0) + 1)
  const prof = (await get(`/rest/v1/app_user_profiles?select=primary_role,is_active,is_deleted&id=eq.${u.id}`))[0]
  const mem = await get(`/rest/v1/user_role_memberships?select=role,is_active&user_id=eq.${u.id}`)
  const pl = players.filter((p) => p.auth_user_id === u.id)
  console.log(`\n[LINE user ${u.id.slice(0, 8)}…] email=${mask(u.email)} confirmed=${Boolean(u.email_confirmed_at)} created=${u.created_at} last_sign_in=${u.last_sign_in_at}`)
  ok('  Auth user 已建立且 email 已確認', Boolean(u.email_confirmed_at))
  ok('  app_metadata.line_sub 已記錄（伺服端欄位，使用者不可改）', Boolean(u.app_metadata?.line_sub))
  ok('  profile = player、啟用中', prof?.primary_role === 'player' && prof?.is_active !== false && !prof?.is_deleted, JSON.stringify(prof))
  ok('  player membership 存在', mem.some((m) => m.role === 'player' && m.is_active), JSON.stringify(mem))
  ok('  players 綁定 line_user_id = line_sub（唯一一筆）', pl.length === 1 && pl[0].line_user_id === sub, `${pl.length} rows`)
}
ok('\n同一 LINE sub 只對應一個 Auth 帳號', [...subs.values()].every((n) => n === 1))
const byLine = new Map()
for (const p of players) byLine.set(p.line_user_id, (byLine.get(p.line_user_id) || 0) + 1)
ok('同一 LINE User ID 只對應一筆 players', [...byLine.values()].every((n) => n === 1))

const logs = await get('/rest/v1/public_signup_error_logs?select=created_at,flow,error_code,error_message&flow=like.line_*&order=created_at.desc&limit=10')
console.log('\n最近 LINE 流程錯誤紀錄（含自動檢查刻意觸發的 state 錯誤）:')
for (const l of Array.isArray(logs) ? logs : []) console.log(`  ${l.created_at} ${l.flow} ${l.error_code} ${l.error_message}`)

const failed = results.filter((x) => !x).length
console.log(`\n[LINE verify] ${results.length - failed}/${results.length} passed`)
