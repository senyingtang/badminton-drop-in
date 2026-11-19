// 093/10 越權測試（Staging only）：node web/scripts/e2e/core-staging/authz-open-registration.mjs。建立臨時帳號 / 場次 / 組織，測完全部刪除。
import fs from 'node:fs'
const SB = 'https://cwvhxkujxsurvrmjexvm.supabase.co'
if (SB.includes('ngudidpitcfyzmbphlgt')) throw new Error('refusing prod')
const SR = fs.readFileSync('D:/project/secrets/staging-service-role.txt', 'utf8').trim()
const ANON = fs.readFileSync('D:/project/secrets/staging.env', 'utf8').match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const AH = { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json' }
const adm = async (path, init = {}) => {
  const r = await fetch(SB + path, { ...init, headers: { ...AH, prefer: 'return=representation', ...(init.headers || {}) } })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return t }
}
const run = Date.now().toString(36), PW = 'Abcd1234!x'
const made = { users: [], sessions: [], orgs: [], accounts: [] }
async function mkUser(tag, role) {
  const email = `t10-${tag}-${run}@example.test`
  const u = await adm('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PW, email_confirm: true }) })
  made.users.push(u.id)
  await adm('/rest/v1/app_user_profiles', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: u.id, display_name: `T10${tag}`, primary_role: role }) })
  const tok = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json()
  if (!tok.access_token) throw new Error('login failed for ' + tag)
  return { id: u.id, jwt: tok.access_token }
}
async function mkSession(host, extra = {}) {
  const body = { title: `T10 ${run}`, host_user_id: host, created_by_user_id: host, start_at: new Date(Date.now() + 864e5).toISOString(), end_at: new Date(Date.now() + 9e7).toISOString(), status: 'draft', ...extra }
  const res = await adm('/rest/v1/sessions', { method: 'POST', body: JSON.stringify(body) })
  if (!Array.isArray(res)) throw new Error('mkSession ' + JSON.stringify(res).slice(0, 200))
  made.sessions.push(res[0].id)
  return res[0].id
}
const call = async (jwt, sid) => {
  const r = await fetch(`${SB}/rest/v1/rpc/kb_open_registration_no_charge`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_session_id: sid }) })
  const j = await r.json().catch(() => null)
  return { s: r.status, m: j?.message || j?.charged_by || JSON.stringify(j) }
}
const status = async (sid) => (await adm(`/rest/v1/sessions?id=eq.${sid}&select=status`))[0]?.status
const res = []
const ok = (n, p, d) => { res.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${n} — ${d}`) }
const patchProfile = (id, b) => adm(`/rest/v1/app_user_profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(b) })
try {
  const hostA = await mkUser('hostA', 'host'), hostB = await mkUser('hostB', 'host'), player = await mkUser('player', 'player')
  const mgr = await mkUser('mgr', 'host'), mgrOff = await mkUser('mgroff', 'host')
  const sA = await mkSession(hostA.id)
  let r
  r = await call(player.jwt, sA); ok('1 一般球友開放他人場次 → 拒絕', r.s >= 400 && /NO_PERMISSION/.test(r.m) && (await status(sA)) === 'draft', `${r.s} ${r.m}`)
  r = await call(hostB.jwt, sA); ok('2 其他團主開放他人場次 → 拒絕', r.s >= 400 && /NO_PERMISSION/.test(r.m) && (await status(sA)) === 'draft', `${r.s} ${r.m}`)
  r = await call(ANON, sA); ok('3 未登入（anon key）→ 拒絕', r.s >= 400 && (await status(sA)) === 'draft', `${r.s} ${r.m}`)
  // 組織路徑
  const [org] = await adm('/rest/v1/kb_organizations', { method: 'POST', body: JSON.stringify({ name: `T10 org ${run}`, owner_user_id: hostA.id }) }); made.orgs.push(org.id)
  const [ba] = await adm('/rest/v1/kb_billing_accounts', { method: 'POST', body: JSON.stringify({ account_type: 'organization', organization_id: org.id, display_name: `T10 ${run}` }) }); made.accounts.push(ba.id)
  await adm('/rest/v1/kb_organization_members', { method: 'POST', body: JSON.stringify([{ organization_id: org.id, user_id: mgr.id, role: 'manager', is_active: true }, { organization_id: org.id, user_id: mgrOff.id, role: 'manager', is_active: false }]) })
  const sOrg = await mkSession(hostA.id, { billing_account_id: ba.id }), sOrg2 = await mkSession(hostA.id, { billing_account_id: ba.id })
  r = await call(player.jwt, sOrg); ok('4 非組織成員開放組織場次 → 拒絕', /NO_PERMISSION/.test(r.m) && (await status(sOrg)) === 'draft', `${r.s} ${r.m}`)
  r = await call(mgrOff.jwt, sOrg); ok('5 已停用的組織管理者 → 拒絕', /NO_PERMISSION/.test(r.m) && (await status(sOrg)) === 'draft', `${r.s} ${r.m}`)
  r = await call(mgr.jwt, sOrg); ok('6 啟用中的組織管理者 → 允許', r.s === 200 && (await status(sOrg)) === 'registration_open', `${r.s} ${r.m}`)
  // 停權 / 刪除（JWT 仍有效）
  await patchProfile(hostA.id, { is_active: false })
  r = await call(hostA.jwt, sA); ok('7 停權團主開放自己的場次 → 拒絕', /ACCOUNT_SUSPENDED/.test(r.m) && (await status(sA)) === 'draft', `${r.s} ${r.m}`)
  await patchProfile(hostA.id, { is_active: true, is_deleted: true })
  r = await call(hostA.jwt, sA); ok('8 已刪除團主 → 拒絕', /ACCOUNT_SUSPENDED/.test(r.m) && (await status(sA)) === 'draft', `${r.s} ${r.m}`)
  await patchProfile(mgr.id, { is_active: false })
  r = await call(mgr.jwt, sOrg2); ok('9 停權的組織管理者 → 拒絕', /ACCOUNT_SUSPENDED/.test(r.m) && (await status(sOrg2)) === 'draft', `${r.s} ${r.m}`)
  await patchProfile(hostA.id, { is_deleted: false })
  // 正常路徑與狀態檢查
  r = await call(hostA.jwt, sA); ok('10 團主開放自己的草稿場次 → 允許、不扣費', r.s === 200 && r.m === 'none_billing_paused' && (await status(sA)) === 'registration_open', `${r.s} ${r.m}`)
  r = await call(hostA.jwt, sA); ok('11 重複開放 → already_open', r.s === 200 && r.m === 'already_open', `${r.s} ${r.m}`)
  const sDone = await mkSession(hostA.id, { status: 'session_finished' })
  r = await call(hostA.jwt, sDone); ok('12 已結束場次 → INVALID_SESSION_STATUS', /INVALID_SESSION_STATUS/.test(r.m) && (await status(sDone)) === 'session_finished', `${r.s} ${r.m}`)
  r = await call(hostA.jwt, '00000000-0000-0000-0000-000000000000'); ok('13 不存在的場次 → SESSION_NOT_FOUND', /SESSION_NOT_FOUND/.test(r.m), `${r.s} ${r.m}`)
  const wt = await adm(`/rest/v1/kb_wallet_transactions?select=id&created_at=gte.${new Date(Date.now() - 6e5).toISOString()}`)
  ok('14 沒有產生錢包交易', Array.isArray(wt) && wt.length === 0, `${Array.isArray(wt) ? wt.length : wt} rows in last 10 min`)
} finally {
  for (const id of made.sessions) await adm(`/rest/v1/sessions?id=eq.${id}`, { method: 'DELETE' })
  for (const id of made.accounts) await adm(`/rest/v1/kb_billing_accounts?id=eq.${id}`, { method: 'DELETE' })
  for (const id of made.orgs) { await adm(`/rest/v1/kb_organization_members?organization_id=eq.${id}`, { method: 'DELETE' }); await adm(`/rest/v1/kb_organizations?id=eq.${id}`, { method: 'DELETE' }) }
  for (const id of made.users) {
    await adm(`/rest/v1/user_role_memberships?user_id=eq.${id}`, { method: 'DELETE' })
    await adm(`/rest/v1/member_referral_profiles?user_id=eq.${id}`, { method: 'DELETE' })
    await adm(`/rest/v1/app_user_profiles?id=eq.${id}`, { method: 'DELETE' })
    await adm(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
  }
  const left = await adm(`/rest/v1/sessions?title=like.T10*&select=id`)
  console.log(`cleanup: ${made.users.length} users / ${made.sessions.length} sessions removed; T10 sessions left = ${Array.isArray(left) ? left.length : left}`)
}
console.log(`[093/10 authz] ${res.filter(Boolean).length}/${res.length} passed`)
