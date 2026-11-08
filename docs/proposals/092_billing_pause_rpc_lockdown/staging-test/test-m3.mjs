// M3 tests: 00e data inventory (read-only, data unchanged by permission SQL), 01e suspension enforcement,
// 05 disable 007 test accounts, and their rollbacks (99e / 99f). PGlite only; never connects to Supabase.
// Usage: node test-m3.mjs <repoRoot>
import fs from 'node:fs'
import path from 'node:path'
import { bootstrap, as } from './bootstrap.mjs'

const ROOT = process.argv[2] || 'D:/project/badminton'
const DOCS = path.join(ROOT, 'docs')
const P = path.join(DOCS, 'proposals/092_billing_pause_rpc_lockdown')
const P93 = path.join(DOCS, 'proposals/093_cloudflare_cutover')
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8')
const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} [m3] ${name}${detail && !pass ? ' — ' + detail : ''}`) }

const { db } = await bootstrap({ docsDir: DOCS })
// Signup / roster / reports migrations used by the live app (load in order; all load on PGlite)
for (const f of ['011_signup_via_share_code_rpc.sql', '013_players_public_handle_line.sql', '015_participants_list_rpc_and_signup_dedupe.sql',
  '016_participants_actions_and_levels.sql', '034_signup_player_code_and_host_profile_auto.sql', '044_session_one_time_display_name_and_cleanup.sql',
  '045_session_participant_paid_status.sql', '046_self_signup_resignup_via_share_code.sql', '064_fix_public_signup_registration_open_compatibility.sql',
  '065_fix_public_signup_submit_registration_open.sql', '081_multi_signup_and_account_deletion.sql', '083_session_operations_reports.sql',
  '084_session_operation_reports_venue_cost.sql']) await db.exec(read(DOCS, f))
// Supabase auth.users columns + pgcrypto stand-ins used by 05
await db.exec(`alter table auth.users add column if not exists raw_app_meta_data jsonb, add column if not exists encrypted_password text,
  add column if not exists banned_until timestamptz, add column if not exists last_sign_in_at timestamptz;
  create or replace function public.gen_random_bytes(int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
  create or replace function public.gen_salt(text) returns text language sql as $$ select '$2a$06$stubsalt' $$;
  create or replace function public.crypt(text, text) returns text language sql as $$ select $2 || md5($1) $$;`)

// ---- fixtures ---------------------------------------------------------------------------------
const id = (n) => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const U = { admin: id(1), adminSus: id(2), host: id(3), hostSus: id(4), player: id(5), playerSus: id(6), t007admin: id(7), t007host: id(8), playerDel: id(9) }
const users = [
  [U.admin, 'real-admin@club.test', 'platform_admin', true], [U.adminSus, 'sus-admin@club.test', 'platform_admin', false],
  [U.host, 'host@club.test', 'host', true], [U.hostSus, 'sus-host@club.test', 'host', false],
  [U.player, 'player@club.test', 'player', true], [U.playerSus, 'sus-player@club.test', 'player', false],
  [U.t007admin, 'admin@example.com', 'platform_admin', true], [U.t007host, 'host@example.com', 'host', true],
  [U.playerDel, 'deleted@club.test', 'player', true],
]
for (const [uid, email, role, active] of users) {
  await db.query(`insert into auth.users(id, email, raw_app_meta_data, encrypted_password) values ($1, $2, '{"provider":"email"}', 'orig-hash')`, [uid, email])
  await db.query(`insert into public.app_user_profiles(id, display_name, primary_role, is_active) values ($1, $2, $3, $4)`, [uid, 'Name ' + email, role, active])
}
await db.query(`update public.app_user_profiles set is_deleted = true where id = $1`, [U.playerDel])
const players = {}
for (const k of ['player', 'playerSus', 'playerDel', 'host']) {
  const r = await db.query(`insert into public.players(player_code, display_name, auth_user_id) values ($1, $2, $3) returning id`, ['PC' + k, 'P ' + k, U[k]])
  players[k] = r.rows[0].id
}
const sess = await db.query(`insert into public.sessions(host_user_id, created_by_user_id, title, start_at, end_at, status, share_signup_code, court_count, allow_self_signup)
  values ($1, $1, '週四臨打', now() + interval '2 days', now() + interval '2 days 3 hours', 'registration_open', 'M3CODE', 2, true) returning id`, [U.host])
const SID = sess.rows[0].id
await db.query(`insert into public.kb_billing_accounts(id, owner_user_id, account_type) values (gen_random_uuid(), $1, 'personal') on conflict do nothing`, [U.player]).catch(() => {})

const signup = (uid, name) => as(db, { role: 'authenticated', sub: uid },
  `select public.self_signup_to_session_by_share_code('M3CODE', 6::smallint, null, $1) as r`, [name], { commit: true })

// ---- 00e: single statement, read-only, no PII --------------------------------------------------
const sql00e = read(P93, '00e_data_inventory_readonly.sql')
const stmts = sql00e.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '').split(';').filter((s) => s.trim())
ok('00e is exactly one statement', stmts.length === 1, `statements=${stmts.length}`)
const run00e = () => db.transaction(async (tx) => { await tx.exec('set transaction read only'); const r = await tx.query(sql00e); await tx.rollback(); return r.rows })
const pre = await signup(U.player, '小明')
ok('baseline: active player can sign up via share-code RPC', pre.ok, pre.error)
let inv0
try { inv0 = await run00e(); ok('00e runs inside a READ ONLY transaction', true) } catch (e) { ok('00e runs inside a READ ONLY transaction', false, e.message); process.exit(1) }
const val = (rows, item) => rows.find((r) => r.item === item)?.value
const blob = JSON.stringify(inv0)
ok('00e output has no email / display names', !/@club\.test|@example\.com|Name |P player/.test(blob))
ok('00e counts profiles', val(inv0, 'app_user_profiles total') === String(users.length))
ok('00e counts sessions + recent list', val(inv0, 'sessions total') === '1' && inv0.some((r) => r.section === 'C2 recent sessions' && /main=1 waitlist=0/.test(r.value)))
ok('00e roster by status', /confirmed_main=1/.test(val(inv0, 'by status (not removed)') || ''), val(inv0, 'by status (not removed)'))
ok('00e operation report sums available (083/084)', val(inv0, 'sum actual_fee / gross / net (cents, not deleted)') === '0 / 0 / 0')
ok('00e missing table → n/a, not an error', (val(inv0, 'session_waitlist_promotions') || '').startsWith('n/a') || /^\d+$/.test(val(inv0, 'session_waitlist_promotions') || ''))

// ---- apply the full permission set; data must be unchanged -----------------------------------
for (const f of ['01d_profile_role_escalation_fix.sql', '01_phase1_lockdown_and_no_charge_open.sql', '01b_rls_read_scoping.sql',
  '01c_quota_dashboard_idor_fix.sql', '01e_suspension_enforcement.sql']) await db.exec(read(P, f))
const inv1 = await run00e()
const strip = (rows) => rows.filter((r) => r.item !== 'checked_at (UTC)').map((r) => `${r.section}|${r.item}|${r.value}`).join('\n')
ok('00e A–Z identical before/after 01d+01+01b+01c+01e (no data changed)', strip(inv0) === strip(inv1))

// ---- 01e: role helpers honour is_active / is_deleted -----------------------------------------
const fn = async (uid, f) => (await as(db, { role: 'authenticated', sub: uid }, `select public.${f}() as v`)).rows?.[0]?.v
ok('01e active admin → is_platform_admin() true', (await fn(U.admin, 'is_platform_admin')) === true)
ok('01e suspended admin → is_platform_admin() false', (await fn(U.adminSus, 'is_platform_admin')) === false)
ok('01e active host → is_host() true', (await fn(U.host, 'is_host')) === true)
ok('01e suspended host → is_host() false', (await fn(U.hostSus, 'is_host')) === false)
ok('01e anon → is_platform_admin() false', (await as(db, { role: 'anon' }, `select public.is_platform_admin() as v`)).rows?.[0]?.v === false)
const helperProps = await db.query(`select proname, prosecdef, proconfig from pg_proc where proname in ('is_platform_admin','is_host','is_venue_owner') order by 1`)
ok('01e helpers are SECURITY DEFINER with fixed search_path', helperProps.rows.every((r) => r.prosecdef && String(r.proconfig).includes('search_path')))

// ---- 01e: signup still works for active users; blocked for suspended / deleted -----------------
const s2 = await signup(U.host, '團主自己')
ok('01e active host can still sign up via RPC', s2.ok, s2.error)
const s3 = await signup(U.playerSus, '停權球友')
ok('01e suspended player blocked (ACCOUNT_SUSPENDED)', !s3.ok && /ACCOUNT_SUSPENDED/.test(s3.error), s3.error)
const s4 = await signup(U.playerDel, '已刪除')
ok('01e deleted account blocked', !s4.ok && /ACCOUNT_SUSPENDED/.test(s4.error), s4.error)
const svc = await as(db, { role: 'service_role' }, `insert into public.session_participants(session_id, player_id, status, source_type) values ($1, $2, 'confirmed_main', 'self_signup') returning id`, [SID, players.playerSus])
ok('01e service_role (no JWT sub) unaffected', svc.ok, svc.error)
const dup = await signup(U.player, '小明')
ok('01e existing rules unchanged (already_signed_up)', !dup.ok && /already_signed_up/.test(dup.error), dup.error)
const roster = await db.query(`select count(*)::int n from public.session_participants where session_id = $1`, [SID])
ok('01e roster rows as expected (player + host)', roster.rows[0].n === 2, `n=${roster.rows[0].n}`)
// suspended host loses RLS write access through is_host(); active host keeps it
const hostUpd = await as(db, { role: 'authenticated', sub: U.host }, `update public.sessions set title = title where id = $1`, [SID])
ok('01e active host can still update own session', hostUpd.ok && hostUpd.affected === 1, hostUpd.error || `affected=${hostUpd.affected}`)

// ---- 99e rollback / re-apply -----------------------------------------------------------------
await db.exec(read(P, '99e_rollback_01e.sql'))
ok('99e: suspended host is_host() back to original behaviour', (await fn(U.hostSus, 'is_host')) === true)
const trg = await db.query(`select count(*)::int n from pg_trigger where tgname = 'trg_kb092_guard_suspended_signup'`)
ok('99e: trigger removed', trg.rows[0].n === 0)
await db.exec(read(P, '01e_suspension_enforcement.sql'))
await db.exec(read(P, '01e_suspension_enforcement.sql'))
ok('01e re-apply is idempotent', (await fn(U.hostSus, 'is_host')) === false)

// ---- 05: disable 007 test accounts -----------------------------------------------------------
const before05 = await db.query(`select count(*)::int n from public.sessions`)
const r05 = await db.exec(read(P, '05_disable_007_test_accounts.sql').replace(/^begin;|^commit;/gm, '')).catch((e) => ({ error: e.message }))
ok('05 runs', !r05.error, r05.error)
const t = await db.query(`select p.id, p.primary_role::text r, p.is_active, u.banned_until, u.encrypted_password from public.app_user_profiles p join auth.users u on u.id = p.id where p.id in ($1, $2, $3)`, [U.t007admin, U.t007host, U.admin])
const row = (uid) => t.rows.find((x) => x.id === uid)
ok('05 admin@example.com demoted, suspended, banned, password replaced', row(U.t007admin).r === 'player' && row(U.t007admin).is_active === false && row(U.t007admin).banned_until !== null && row(U.t007admin).encrypted_password !== 'orig-hash')
ok('05 host@example.com disabled', row(U.t007host).r === 'player' && row(U.t007host).is_active === false)
ok('05 real admin untouched', row(U.admin).r === 'platform_admin' && row(U.admin).is_active === true && row(U.admin).banned_until === null)
ok('05 test admin no longer platform admin (JWT)', (await fn(U.t007admin, 'is_platform_admin')) === false)
const logs = await db.query(`select count(*)::int n from public.kb_audit_logs where action_type = 'm3_disable_007_test_account'`)
ok('05 audit log per account', logs.rows[0].n === 2, `n=${logs.rows[0].n}`)
ok('05 no rows deleted', (await db.query(`select count(*)::int n from public.sessions`)).rows[0].n === before05.rows[0].n)
await db.exec(read(P, '05_disable_007_test_accounts.sql').replace(/^begin;|^commit;/gm, ''))
await db.exec(read(P, '99f_rollback_05.sql'))
const t2 = await db.query(`select p.primary_role::text r, p.is_active, u.banned_until from public.app_user_profiles p join auth.users u on u.id = p.id where p.id = $1`, [U.t007admin])
ok('99f restores original role / active / unban (even after 05 ran twice)', t2.rows[0].r === 'platform_admin' && t2.rows[0].is_active === true && t2.rows[0].banned_until === null, JSON.stringify(t2.rows[0]))

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
