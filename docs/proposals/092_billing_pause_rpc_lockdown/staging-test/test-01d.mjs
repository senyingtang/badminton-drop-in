// 01d standalone test: 01d applied ALONE (no 01 / 01b / 01c / 02), first on the 001–053 schema,
// then after adding the 081 soft-delete columns and profiles.line_oa_user_id.
// Never connects to Supabase. Usage: node test-01d.mjs <repoRoot>
import fs from 'node:fs'
import path from 'node:path'
import { bootstrap, as } from './bootstrap.mjs'

const ROOT = process.argv[2] || 'D:/project/badminton'
const P = path.join(ROOT, 'docs/proposals/092_billing_pause_rpc_lockdown')
const sql01d = fs.readFileSync(path.join(P, '01d_profile_role_escalation_fix.sql'), 'utf8')
const sql99d = fs.readFileSync(path.join(P, '99d_rollback_01d.sql'), 'utf8')

const results = []
const ok = (group, name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'} [${group}] ${name}${detail && !pass ? ' — ' + detail : ''}`)
}
const blocked = (r) => !r.ok && /ROLE_CHANGE_NOT_ALLOWED|permission denied|row-level security/i.test(r.error)
const blockedOrNoop = (r) => blocked(r) || (r.ok && r.affected === 0)

const U = {
  admin: 'e0000000-0000-4000-8000-000000000001',
  inactiveAdmin: 'e0000000-0000-4000-8000-000000000002',
  member: 'e0000000-0000-4000-8000-000000000003',
  suspended: 'e0000000-0000-4000-8000-000000000004',
  deleted: 'e0000000-0000-4000-8000-000000000005',
  host: 'e0000000-0000-4000-8000-000000000006',
  venueOwner: 'e0000000-0000-4000-8000-000000000007',
  fresh: 'e0000000-0000-4000-8000-000000000008', // auth user without a profile yet (first login)
  fresh2: 'e0000000-0000-4000-8000-000000000009',
}
const anon = { role: 'anon' }
const user = (sub) => ({ role: 'authenticated', sub })
const svc = { role: 'service_role' }

const { db } = await bootstrap({ docsDir: path.join(ROOT, 'docs') })
const roleOf = { admin: 'platform_admin', inactiveAdmin: 'platform_admin', host: 'host', venueOwner: 'venue_owner' }
for (const [k, id] of Object.entries(U)) {
  await db.query(`insert into auth.users(id, email) values ($1, $2)`, [id, `${k}@example.test`])
  if (k.startsWith('fresh')) continue
  await db.query(`insert into public.app_user_profiles(id, display_name, primary_role, is_active) values ($1, $2, $3::app_role, $4)`,
    [id, k, roleOf[k] ?? 'player', !['inactiveAdmin', 'suspended'].includes(k)])
}
// a custom role that only has what PUBLIC / authenticated-style grants give it (fail-closed check)
await db.exec(`create role rogue nologin noinherit;
  grant usage on schema public, auth to rogue;
  grant select, insert, update on public.app_user_profiles to rogue;
  grant execute on all functions in schema public, auth to rogue;`)

const upd = (who, set, id) => as(db, who, `update public.app_user_profiles set ${set} where id = $1`, [id])
const snapshot = async () => JSON.stringify((await db.query(`select id, primary_role, is_active from public.app_user_profiles order by id`)).rows)

// ---------------- Phase A: 001–053 schema (no 081 columns) ----------------
{
  const b1 = await upd(user(U.member), `primary_role = 'platform_admin'`, U.member)
  ok('baseline', 'BEFORE 01d: member self-promotes to platform_admin (P0 reproduced)', b1.ok && b1.affected === 1, b1.error)
  const b2 = await upd(user(U.suspended), `is_active = true`, U.suspended)
  ok('baseline', 'BEFORE 01d: suspended member re-activates self', b2.ok && b2.affected === 1, b2.error)
  const b3 = await as(db, user(U.fresh), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'platform_admin')`, [U.fresh])
  ok('baseline', 'BEFORE 01d: first-login user creates own profile as platform_admin', b3.ok, b3.error)
  const b4 = await upd({ role: 'rogue', sub: U.member }, `primary_role = 'platform_admin'`, U.member)
  ok('baseline', 'BEFORE 01d: any other non-bypass role (PUBLIC-style grants) can self-promote', b4.ok && b4.affected === 1, b4.error)
}
const snapA = await snapshot()
try { await db.exec(sql01d); await db.exec(sql01d); ok('apply', '01d applies ALONE on 001–053 schema (no 01/01b/01c) and is re-runnable', true) }
catch (e) { ok('apply', '01d applies ALONE on 001–053 schema and is re-runnable', false, e.message) }
ok('apply', 'applying 01d changes no rows', (await snapshot()) === snapA)
{
  ok('phase A', 'member → platform_admin blocked', blocked(await upd(user(U.member), `primary_role = 'platform_admin'`, U.member)))
  ok('phase A', 'suspended → is_active=true blocked', blocked(await upd(user(U.suspended), `is_active = true`, U.suspended)))
  const r = await upd(user(U.member), `display_name = 'renamed', phone = '0900'`, U.member)
  ok('phase A', 'member display_name / phone edit still works (ProfileForm)', r.ok && r.affected === 1, r.error)
}

// ---------------- Phase B: + 081 soft-delete columns + profiles.line_oa_user_id ----------------
await db.exec(`alter table public.app_user_profiles
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists account_deleted_at timestamptz,
  add column if not exists deleted_display_name_snapshot text,
  add column if not exists anonymized_at timestamptz,
  add column if not exists avatar_url text,
  add column if not exists line_oa_user_id text;
  update public.app_user_profiles set is_deleted = true, deleted_at = now(), account_deleted_at = now(), anonymized_at = now(), is_active = false where id = '${U.deleted}';`)
await db.exec(sql01d)
const snapB = await snapshot()

const attacks = [
  ['member → platform_admin', user(U.member), `primary_role = 'platform_admin'`, U.member],
  ['member → host', user(U.member), `primary_role = 'host'`, U.member],
  ['member → venue_owner', user(U.member), `primary_role = 'venue_owner'`, U.member],
  ['host → platform_admin', user(U.host), `primary_role = 'platform_admin'`, U.host],
  ['venue_owner → platform_admin', user(U.venueOwner), `primary_role = 'platform_admin'`, U.venueOwner],
  ['suspended member re-activates self', user(U.suspended), `is_active = true`, U.suspended],
  ['deleted member un-deletes self', user(U.deleted), `is_deleted = false`, U.deleted],
  ['deleted member clears account_deleted_at', user(U.deleted), `account_deleted_at = null`, U.deleted],
  ['member forges own line_oa_user_id', user(U.member), `line_oa_user_id = 'Uattacker'`, U.member],
  ['member sets own is_deleted (fake deletion)', user(U.member), `is_deleted = true`, U.member],
  ['SUSPENDED admin promotes a member', user(U.inactiveAdmin), `primary_role = 'platform_admin'`, U.member],
  ['SUSPENDED admin re-activates self', user(U.inactiveAdmin), `is_active = true`, U.inactiveAdmin],
  ['custom role with PUBLIC-style grants self-promotes', { role: 'rogue', sub: U.member }, `primary_role = 'platform_admin'`, U.member],
]
for (const [name, who, set, id] of attacks) {
  const r = await upd(who, set, id)
  ok('attack blocked', name, blockedOrNoop(r), r.ok ? `allowed, affected=${r.affected}` : r.error)
}
{
  const r = await as(db, anon, `update public.app_user_profiles set primary_role = 'platform_admin'`)
  ok('attack blocked', 'anon mass-update roles', blockedOrNoop(r), r.ok ? `affected=${r.affected}` : r.error)
  const up = await as(db, user(U.member), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'x', 'player')
    on conflict (id) do update set primary_role = 'platform_admin'`, [U.member])
  ok('attack blocked', 'upsert (on conflict do update) cannot change role', blocked(up), up.ok ? 'allowed' : up.error)
  const i1 = await as(db, user(U.fresh2), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'platform_admin')`, [U.fresh2])
  ok('attack blocked', 'first-login user cannot create own profile as platform_admin', blocked(i1), i1.error)
  const i2 = await as(db, user(U.fresh2), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'host')`, [U.fresh2])
  ok('attack blocked', 'first-login user cannot create own profile as host', blocked(i2), i2.error)
  const i3 = await as(db, user(U.fresh2), `insert into public.app_user_profiles(id, display_name, primary_role, line_oa_user_id) values ($1, 'n', 'player', 'Ux')`, [U.fresh2])
  ok('attack blocked', 'first-login user cannot pre-bind a LINE OA id', blocked(i3), i3.error)
  const i4 = await as(db, { role: 'rogue', sub: U.fresh2 }, `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'platform_admin')`, [U.fresh2])
  ok('attack blocked', 'custom role cannot insert a platform_admin profile', blocked(i4), i4.error)
  const ex = await as(db, anon, `select public.kb092_caller_is_active_platform_admin()`)
  ok('attack blocked', 'anon cannot execute the admin helper', !ex.ok && /permission denied/.test(ex.error), ex.error || 'allowed')
}
ok('attack blocked', 'no profile row changed by any attack', (await snapshot()) === snapB)

// ---- legitimate paths that must keep working ----
const legit = [
  ['member edits display_name / phone / avatar_url (ProfileForm)', user(U.member), `display_name = 'me', phone = '0911', avatar_url = 'x'`, U.member],
  ['host edits own display_name (host permissions unaffected)', user(U.host), `display_name = 'host2'`, U.host],
  ['ACTIVE admin changes another user role (/admin/users page, user JWT)', user(U.admin), `primary_role = 'host'`, U.member],
  ['ACTIVE admin suspends a user (/admin/users page)', user(U.admin), `is_active = false`, U.host],
  ['ACTIVE admin restores a suspended user', user(U.admin), `is_active = true`, U.suspended],
  ['service_role bulk-update-role API', svc, `primary_role = 'venue_owner'`, U.member],
  ['service_role bulk-disable / bulk-restore API', svc, `is_active = false`, U.member],
  ['service_role LINE webhook binds line_oa_user_id', svc, `line_oa_user_id = 'Uline'`, U.member],
  ['service_role member account delete (anonymize)', svc, `is_deleted = true, deleted_at = now(), account_deleted_at = now(), anonymized_at = now(), deleted_display_name_snapshot = 'x', is_active = false, display_name = '已刪除'`, U.venueOwner],
  ['postgres (SQL Editor) changes a role', { role: 'postgres' }, `primary_role = 'player'`, U.member],
]
for (const [name, who, set, id] of legit) {
  const r = await upd(who, set, id)
  ok('legit path', name, r.ok && r.affected === 1, r.error || `affected=${r.affected}`)
}
{
  const r1 = await as(db, user(U.fresh), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'player')`, [U.fresh])
  ok('legit path', 'first-login user creates own player profile (useProfileSync)', r1.ok, r1.error)
  const r2 = await as(db, svc, `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'player')`, [U.fresh2])
  ok('legit path', 'service_role creates profile (LINE Login callback)', r2.ok, r2.error)
  await db.exec(`create or replace function public.t01d_definer_set_role(p uuid) returns void language sql security definer as $$ update public.app_user_profiles set primary_role = 'host' where id = p $$;
    grant execute on function public.t01d_definer_set_role(uuid) to authenticated;`)
  const r3 = await as(db, user(U.admin), `select public.t01d_definer_set_role($1)`, [U.member])
  ok('legit path', 'postgres-owned SECURITY DEFINER function can still write roles', r3.ok, r3.error)
  await db.exec(`drop function public.t01d_definer_set_role(uuid)`)
  const h = await as(db, user(U.host), `select public.is_host() h, public.is_platform_admin() a`)
  ok('legit path', 'is_host() / is_platform_admin() unchanged for host', h.ok && h.rows[0].h === true && h.rows[0].a === false, h.error)
  const a = await as(db, user(U.admin), `select public.is_platform_admin() a`)
  ok('legit path', 'is_platform_admin() still true for the real admin', a.ok && a.rows[0].a === true, a.error)
  const self = await upd(user(U.admin), `primary_role = 'host'`, U.admin)
  ok('legit path', 'active admin can demote self (no lock-in)', self.ok && self.affected === 1, self.error)
}

// ---------------- rollback ----------------
try {
  await db.exec(sql99d)
  const r = await upd(user(U.member), `primary_role = 'platform_admin'`, U.member)
  const left = (await db.query(`select count(*)::int n from pg_proc where proname like 'kb092_%'`)).rows[0].n
  ok('rollback', '99d removes trigger + both functions (documented as re-exposing P0)', r.ok && r.affected === 1 && left === 0, r.error || `left=${left}`)
  await db.exec(sql01d)
  ok('rollback', 're-applying 01d after 99d blocks again', blocked(await upd(user(U.suspended), `is_active = true`, U.suspended)))
} catch (e) { ok('rollback', '99d / re-apply', false, e.message) }

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
