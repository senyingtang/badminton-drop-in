// 00d diagnostic test: runs the Production read-only diagnostic on PGlite, inside a READ ONLY transaction,
// with a simulated self-promoted admin and a self-unsuspended member. Usage: node test-00d.mjs <repoRoot>
import fs from 'node:fs'
import path from 'node:path'
import { bootstrap, as } from './bootstrap.mjs'

const ROOT = process.argv[2] || 'D:/project/badminton'
const P = path.join(ROOT, 'docs/proposals/092_billing_pause_rpc_lockdown')
const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} [00d] ${name}${detail && !pass ? ' — ' + detail : ''}`) }

const { db } = await bootstrap({ docsDir: path.join(ROOT, 'docs') })
// Supabase auth.users columns used by 00d
await db.exec(`alter table auth.users add column if not exists raw_app_meta_data jsonb,
  add column if not exists last_sign_in_at timestamptz, add column if not exists banned_until timestamptz`)
const [owner, mallory, sus] = ['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003']
await db.query(`insert into auth.users(id, email, raw_app_meta_data) values ($1, 'owner@example.com', '{"provider":"email"}'), ($2, 'mallory@evil.test', '{"provider":"line"}'), ($3, 'sus@x.test', null)`, [owner, mallory, sus])
await db.query(`insert into public.app_user_profiles(id, display_name, primary_role, phone, created_at) values
  ($1, 'Owner', 'platform_admin', '0911222333', now() - interval '1 day'), ($2, 'Mallory', 'player', null, now() - interval '1 day'), ($3, 'Sus', 'player', null, now())`, [owner, mallory, sus])
await as(db, { role: 'authenticated', sub: mallory }, `update public.app_user_profiles set primary_role = 'platform_admin' where id = $1`, [mallory], { commit: true })
await db.query(`update public.app_user_profiles set is_active = false where id = $1`, [sus])
await db.query(`insert into public.kb_audit_logs(actor_user_id, action_type, target_entity_type, target_entity_id) values ($1, 'bulk_disable_user', 'user', $2)`, [owner, sus])
await as(db, { role: 'authenticated', sub: sus }, `update public.app_user_profiles set is_active = true where id = $1`, [sus], { commit: true })

const sql = fs.readFileSync(path.join(P, '00d_inspect_identity_readonly.sql'), 'utf8').replace("lower(trim(''))", "lower(trim('owner@example.com'))")
const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .replace(/\$q\$[\s\S]*?\$q\$/g, "''").replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '')
  .split(';').filter((s) => s.trim())
ok('file is exactly one statement (SQL Editor shows all results)', statements.length === 1, `statements=${statements.length}`)

const run = () => db.transaction(async (tx) => { await tx.exec('set transaction read only'); const r = await tx.query(sql); await tx.rollback(); return r.rows })
const find = (rows, sec, item) => rows.find((r) => r.section.startsWith(sec) && (item === undefined || r.item === item))

let before
try { before = await run(); ok('runs inside a READ ONLY transaction (no writes)', true) } catch (e) { ok('runs inside a READ ONLY transaction (no writes)', false, e.message); process.exit(1) }
const blob = JSON.stringify(before)
ok('no secrets / phone / full email / full name in output', !/0911222333|owner@example\.com|mallory@evil\.test|"Mallory"|"Owner"/.test(blob))
ok('before 01d: guard missing → RISK', find(before, 'E trigger', '01d guard trigger present')?.status === 'RISK')
ok('before 01d: self-update policy flagged RISK', find(before, 'C policy', 'app_user_profiles / app_user_profiles_update_self_or_admin')?.status === 'RISK')
ok('expected admin marked OK', find(before, 'J admin', owner)?.status === 'OK')
ok('self-promoted admin surfaces for review', find(before, 'J admin', mallory)?.status === 'REVIEW' && !!find(before, 'L5', mallory))
ok('self-unsuspended member flagged RISK (L1)', find(before, 'L1', sus)?.status === 'RISK')
ok('test-domain admin (007 password123 accounts) flagged RISK (L7)', find(before, 'L7', owner)?.status === 'RISK')
ok('is_platform_admin() without is_active flagged REVIEW', find(before, 'F role helper', 'is_platform_admin()')?.status === 'REVIEW')

await db.exec(fs.readFileSync(path.join(P, '01d_profile_role_escalation_fix.sql'), 'utf8'))
const after = await run()
ok('after 01d: guard present → OK', find(after, 'E trigger', '01d guard trigger present')?.status === 'OK')
ok('after 01d: self-update policy no longer RISK', find(after, 'C policy', 'app_user_profiles / app_user_profiles_update_self_or_admin')?.status === 'INFO')
ok('after 01d: authenticated UPDATE grant → OK (guarded)', find(after, 'D grant', 'app_user_profiles → authenticated')?.status === 'OK')
ok('after 01d: applied marker visible', find(after, 'M applied', 'public.kb092_caller_is_active_platform_admin()')?.status === 'INFO applied')

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
