// 092 staging test: builds a Supabase-like Postgres from the repo migrations (PGlite, in-memory),
// then runs 00 → (baseline attacks) → 01 → 03 → tests → 02 → 03 → rollbacks.
// Usage: node staging-test.mjs <repoRoot>
import fs from 'node:fs'
import path from 'node:path'
import { bootstrap, as } from './bootstrap.mjs'

const ROOT = process.argv[2] || 'D:/project/badminton'
const DOCS = path.join(ROOT, 'docs')
const P = path.join(DOCS, 'proposals/092_billing_pause_rpc_lockdown')
const sqlFile = (f) => fs.readFileSync(path.join(P, f), 'utf8')

const results = []
const ok = (group, name, pass, detail = '') => {
  results.push({ group, name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${group}] ${name}${detail ? ' — ' + detail : ''}`)
}

const U = {
  host: 'a0000000-0000-4000-8000-000000000001',
  other: 'a0000000-0000-4000-8000-000000000002',
  orgOwner: 'a0000000-0000-4000-8000-000000000003',
  orgManager: 'a0000000-0000-4000-8000-000000000004',
  orgInactive: 'a0000000-0000-4000-8000-000000000005',
  venueOwner: 'a0000000-0000-4000-8000-000000000006',
  admin: 'a0000000-0000-4000-8000-000000000007',
  attacker: 'a0000000-0000-4000-8000-000000000008',
}
const S = {
  hostDraft: 'b0000000-0000-4000-8000-000000000001',
  orgDraft: 'b0000000-0000-4000-8000-000000000002',
  assigned: 'b0000000-0000-4000-8000-000000000003',
  pending: 'b0000000-0000-4000-8000-000000000004',
}
const ORG = 'c0000000-0000-4000-8000-000000000001'
const ORG_BA = 'c0000000-0000-4000-8000-000000000002'
const VENUE = 'd0000000-0000-4000-8000-000000000001'

const { db, errors } = await bootstrap({ docsDir: DOCS })
ok('setup', 'migrations 001–053 loaded (only legacy 005_rpc_and_views fails: kb_players missing)',
  errors.length === 1 && errors[0].file === '005_rpc_and_views.sql', JSON.stringify(errors))

// ---------- fixtures (superuser) ----------
const role = (u) => (u === U.admin ? 'platform_admin' : u === U.venueOwner ? 'venue_owner' : u === U.other || u === U.attacker ? 'player' : 'host')
for (const [k, id] of Object.entries(U)) {
  await db.query(`insert into auth.users(id, email) values ($1, $2)`, [id, `${k}@example.test`])
  await db.query(`insert into public.app_user_profiles(id, display_name, primary_role) values ($1, $2, $3::app_role)`, [id, k, role(id)])
}
await db.query(`insert into public.venues(id, owner_user_id, name) values ($1, $2, 'Test Venue')`, [VENUE, U.venueOwner])
await db.query(`insert into public.kb_organizations(id, name, owner_user_id) values ($1, 'Org', $2)`, [ORG, U.orgOwner])
await db.query(`insert into public.kb_organization_members(organization_id, user_id, role, is_active) values
  ($1, $2, 'owner', true), ($1, $3, 'manager', true), ($1, $4, 'host', false)`, [ORG, U.orgOwner, U.orgManager, U.orgInactive])
await db.query(`insert into public.kb_billing_accounts(id, account_type, display_name, organization_id) values ($1, 'organization', 'Org BA', $2)`, [ORG_BA, ORG])
await db.query(`insert into public.kb_wallets(billing_account_id, balance, balance_cents) values ($1, 500, 50000)`, [ORG_BA])
for (const u of [U.host, U.other, U.attacker]) {
  const { rows } = await db.query(`select public.kb_create_personal_billing_account_if_missing($1) ba`, [u])
  await db.query(`update public.kb_wallets set balance = 1000, balance_cents = 100000 where billing_account_id = $1`, [rows[0].ba])
}
const start = new Date(Date.now() + 86400e3).toISOString()
const end = new Date(Date.now() + 2 * 86400e3).toISOString()
const mkSession = (id, host, status, extra = {}) => db.query(
  `insert into public.sessions(id, host_user_id, created_by_user_id, title, start_at, end_at, status, venue_id, billing_account_id)
   values ($1, $2, $2, 't', $3, $4, $5::session_status_type, $6, $7)`,
  [id, host, start, end, status, extra.venue ?? VENUE, extra.ba ?? null])
await mkSession(S.hostDraft, U.host, 'draft')
await mkSession(S.orgDraft, U.orgOwner, 'draft', { ba: ORG_BA })
await mkSession(S.assigned, U.host, 'assigned')
await mkSession(S.pending, U.host, 'pending_confirmation')

const snapshot = async () => (await db.query(`select
   (select coalesce(sum(balance_cents),0)::text from public.kb_wallets) wallet_cents,
   (select coalesce(sum(balance),0)::text from public.kb_wallets) wallet_twd,
   (select count(*)::int from public.kb_wallet_transactions) wallet_txns,
   (select coalesce(sum(quota_used),0)::int from public.kb_quota_buckets) quota_used,
   (select count(*)::int from public.kb_quota_ledger) quota_ledger,
   (select count(*)::int from public.kb_billing_events) billing_events,
   (select count(*)::int from public.kb_organization_members) org_members`)).rows[0]
const snap0 = await snapshot()

const denied = (r) => !r.ok && /permission denied|NO_PERMISSION|UNAUTHENTICATED|row-level security/i.test(r.error)
const anon = { role: 'anon' }
const user = (sub) => ({ role: 'authenticated', sub })
const debitSql = `select public.kb_wallet_debit_cents($1::uuid, 100, $2::uuid, 'session_registration'::kb_wallet_txn_reason, 'test', null)`
const hostBa = (await db.query(`select id from public.kb_billing_accounts where owner_user_id = $1`, [U.host])).rows[0]?.id

// ---------- 00 (read-only) runs cleanly ----------
try { await db.exec(sqlFile('00_inspect_readonly.sql')); ok('00', '00_inspect_readonly.sql runs without error', true) }
catch (e) { ok('00', '00_inspect_readonly.sql runs without error', false, e.message) }
ok('00', '00 is read-only (snapshot unchanged)', JSON.stringify(await snapshot()) === JSON.stringify(snap0))

// ---------- Baseline: demonstrate the holes BEFORE 01 (all rolled back) ----------
{
  const r1 = await as(db, anon, debitSql, [hostBa, U.attacker])
  ok('baseline', 'BEFORE 01: anon CAN call kb_wallet_debit_cents on someone else\'s wallet (P0 confirmed)', r1.ok, r1.error || '')
  const r2 = await as(db, anon, `update public.kb_wallets set balance_cents = 99999999 where billing_account_id = $1`, [hostBa])
  ok('baseline', 'BEFORE 01: anon CAN directly UPDATE kb_wallets balance (P0 confirmed)', r2.ok && r2.affected === 1, r2.error || '')
  const r3 = await as(db, user(U.attacker), `insert into public.kb_organization_members(organization_id, user_id, role) values ($1, $2, 'owner')`, [ORG, U.attacker])
  ok('baseline', 'BEFORE 01: any user CAN add self as org owner (forges 052 org permission)', r3.ok, r3.error || '')
  const r4 = await as(db, user(U.attacker), `select public.kb_user_self_wallet_topup(20000)`)
  ok('baseline', 'BEFORE 01: any user CAN self-mint 20000 via kb_user_self_wallet_topup', r4.ok, r4.error || '')
  ok('baseline', 'baseline attacks were rolled back (snapshot unchanged)', JSON.stringify(await snapshot()) === JSON.stringify(snap0))
}

// ---------- Old App (pre-01): with_billing as host works (reference behaviour) ----------
const oldOpen = await as(db, user(U.host), `select public.kb_open_registration_with_billing($1) r`, [S.hostDraft])
ok('compat', 'BEFORE 01: old App open-registration (with_billing) works for host', oldOpen.ok, oldOpen.error || JSON.stringify(oldOpen.rows?.[0]?.r))

// ---------- Task B: permission matrix, 052 vs no_charge (no_charge created in a throwaway tx first) ----------
// Build the matrix after 01 (no_charge exists); 052 decision is evaluated in the same state.

// ---------- Apply 01 ----------
try { await db.exec(sqlFile('01_phase1_lockdown_and_no_charge_open.sql')); ok('01', '01 applies cleanly', true) }
catch (e) { ok('01', '01 applies cleanly', false, e.message) }
try { await db.exec(sqlFile('01_phase1_lockdown_and_no_charge_open.sql')); ok('01', '01 is re-runnable (idempotent)', true) }
catch (e) { ok('01', '01 is re-runnable (idempotent)', false, e.message) }
ok('01', '01 did not change balances / ledgers', JSON.stringify(await snapshot()) === JSON.stringify(snap0))
try { await db.exec(sqlFile('03_verify_readonly.sql')); ok('03', '03_verify_readonly.sql runs without error', true) }
catch (e) { ok('03', '03_verify_readonly.sql runs without error', false, e.message) }

// Test 2: ordinary users / anon cannot debit or mint
{
  const attacks = [
    ['anon kb_wallet_debit_cents', anon, debitSql, [hostBa, U.attacker]],
    ['user kb_wallet_debit_cents (other\'s wallet)', user(U.attacker), debitSql, [hostBa, U.attacker]],
    ['user kb_wallet_debit (legacy)', user(U.attacker), `select public.kb_wallet_debit($1::uuid, 1, 'overage_charge', null, 'x')`, [hostBa]],
    ['user kb_user_self_wallet_topup', user(U.attacker), `select public.kb_user_self_wallet_topup(20000)`, []],
    ['user kb_create_personal_billing_account_if_missing', user(U.attacker), `select public.kb_create_personal_billing_account_if_missing($1)`, [U.other]],
    ['user kb_resolve_billing_account_for_session', user(U.attacker), `select public.kb_resolve_billing_account_for_session($1)`, [S.hostDraft]],
    ['user apply_wallet_transaction (legacy)', user(U.attacker), `select p.oid::regprocedure from pg_proc p where proname='apply_wallet_transaction' and has_function_privilege('authenticated', p.oid, 'execute')`, []],
    ['anon UPDATE kb_wallets', anon, `update public.kb_wallets set balance_cents = 99999999 where billing_account_id = $1`, [hostBa]],
    ['user UPDATE kb_wallets', user(U.attacker), `update public.kb_wallets set balance_cents = 99999999`, []],
    ['user INSERT kb_wallet_transactions', user(U.attacker), `insert into public.kb_wallet_transactions(wallet_id, txn_type, amount, balance_before, balance_after) select id, 'topup', 1, 0, 1 from public.kb_wallets limit 1`, []],
    ['user INSERT kb_organization_members (self as owner)', user(U.attacker), `insert into public.kb_organization_members(organization_id, user_id, role) values ($1, $2, 'owner')`, [ORG, U.attacker]],
    ['user UPDATE kb_quota_buckets', user(U.attacker), `update public.kb_quota_buckets set quota_limit = 9999`, []],
    ['user UPDATE kb_subscriptions', user(U.attacker), `update public.kb_subscriptions set status = status`, []],
    ['user UPDATE legacy wallet_accounts', user(U.attacker), `update public.wallet_accounts set owner_user_id = owner_user_id`, []],
  ]
  for (const [name, who, q, params] of attacks) {
    const r = await as(db, who, q, params)
    const blocked = name.includes('apply_wallet_transaction') ? (r.ok && r.rows.length === 0) : denied(r)
    ok('T2 no arbitrary debit', `AFTER 01: ${name} is blocked`, blocked, r.ok ? `ok rows=${r.rows?.length} affected=${r.affected}` : r.error)
  }
  const sweep = await db.query(`select p.oid::regprocedure::text sig,
      has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
      has_function_privilege('service_role', p.oid, 'execute') s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['kb_wallet_debit_cents','kb_wallet_debit','kb_subscription_activate',
      'kb_subscription_renew','kb_create_personal_billing_account_if_missing','kb_resolve_billing_account_for_session',
      'kb_billing_consume_on_session_start','kb_billing_preflight_session_start','apply_wallet_transaction',
      'ensure_wallet_account','charge_session_first_start','kb_user_self_wallet_topup'])`)
  ok('T2 no arbitrary debit', `privilege sweep: all ${sweep.rows.length} phase-1 functions denied to anon + authenticated, granted to service_role`,
    sweep.rows.length >= 12 && sweep.rows.every((x) => !x.a && !x.u && x.s), JSON.stringify(sweep.rows.filter((x) => x.a || x.u || !x.s)))
  const r = await as(db, user(U.attacker), `select balance_cents from public.kb_wallets limit 1`)
  ok('T2 no arbitrary debit', 'AFTER 01: SELECT on kb_wallets unchanged (admin page read-only balance still works)', r.ok)
}

// Old App compat after 01 (before 02): with_billing still works, its internal debit (DEFINER chain) still works
{
  const r = await as(db, user(U.host), `select public.kb_open_registration_with_billing($1) r`, [S.hostDraft])
  ok('compat', 'AFTER 01: old App with_billing still works for host (Vercel old site unaffected)', r.ok, r.error || JSON.stringify(r.rows?.[0]?.r))
  // Force the wallet path: exhaust quota by giving no bucket → charged_by wallet
  const r2 = await db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.host])
    const o = await tx.query(`select public.kb_open_registration_with_billing($1) r`, [S.pending])
    await tx.exec('reset role')
    const w = await tx.query(`select balance_cents::text from public.kb_wallets where billing_account_id = $1`, [hostBa])
    await tx.rollback()
    return { r: o.rows[0].r, after: w.rows[0].balance_cents }
  }).catch((e) => ({ error: e.message }))
  ok('compat', 'AFTER 01: DEFINER chain with_billing → kb_wallet_debit_cents still executes (revoke does not break internal calls)',
    !r2.error && (r2.r?.charged_by === 'wallet' ? r2.after !== '100000' : true), JSON.stringify(r2))
  ok('compat', 'compat checks rolled back (snapshot unchanged)', JSON.stringify(await snapshot()) === JSON.stringify(snap0))
}

// Task B / Test 4: permission matrix — 052 (with_billing) vs no_charge must agree for every actor
{
  const actors = [
    ['session host', user(U.host), S.hostDraft], ['ordinary user', user(U.other), S.hostDraft],
    ['venue owner of the session venue', user(U.venueOwner), S.hostDraft], ['platform admin', user(U.admin), S.hostDraft],
    ['anon', anon, S.hostDraft],
    ['org owner (not host) on org session', user(U.orgOwner), S.orgDraft], ['org manager on org session', user(U.orgManager), S.orgDraft],
    ['inactive org member on org session', user(U.orgInactive), S.orgDraft], ['ordinary user on org session', user(U.other), S.orgDraft],
    ['venue owner on org session', user(U.venueOwner), S.orgDraft], ['platform admin on org session', user(U.admin), S.orgDraft],
  ]
  const decide = (r) => (denied(r) ? 'DENY' : 'ALLOW')
  for (const [name, who, sid] of actors) {
    const a = await as(db, who, `select public.kb_open_registration_with_billing($1) r`, [sid])
    const b = await as(db, who, `select public.kb_open_registration_no_charge($1) r`, [sid])
    ok('T4 / Task B permissions', `${name}: 052=${decide(a)} no_charge=${decide(b)}`, decide(a) === decide(b),
      `052: ${a.ok ? 'ok' : a.error} | no_charge: ${b.ok ? JSON.stringify(b.rows[0].r) : b.error}`)
  }
  // Non-authorised users cannot modify someone else's session through RLS either (status, billing columns)
  const r = await as(db, user(U.other), `update public.sessions set status = 'registration_open' where id = $1`, [S.hostDraft])
  ok('T4 / Task B permissions', 'ordinary user cannot UPDATE another host\'s session via REST (RLS: 0 rows)', r.ok && r.affected === 0, r.error || `affected=${r.affected}`)
  ok('T4 / Task B permissions', 'matrix rolled back (snapshot unchanged)', JSON.stringify(await snapshot()) === JSON.stringify(snap0))
}

// Test 3 + 5 + 6: host opens for free (committed), idempotent, balances unchanged
{
  const before = await snapshot()
  const r = await as(db, user(U.host), `select public.kb_open_registration_no_charge($1) r`, [S.hostDraft], { commit: true })
  const s1 = (await db.query(`select status::text, allow_self_signup, registration_opened_at, updated_at from public.sessions where id = $1`, [S.hostDraft])).rows[0]
  ok('T3 host opens free', 'host opens registration with no_charge', r.ok && r.rows[0].r.charged_by === 'none_billing_paused', r.error || JSON.stringify(r.rows[0].r))
  ok('T3 host opens free', 'session is registration_open + allow_self_signup', s1.status === 'registration_open' && s1.allow_self_signup === true, JSON.stringify(s1))
  ok('T3 host opens free', 'no wallet / quota / ledger / billing_event change', JSON.stringify(await snapshot()) === JSON.stringify(before))
  const r2 = await as(db, user(U.host), `select public.kb_open_registration_no_charge($1) r`, [S.hostDraft], { commit: true })
  const s2 = (await db.query(`select status::text, allow_self_signup, registration_opened_at, updated_at from public.sessions where id = $1`, [S.hostDraft])).rows[0]
  ok('T5 idempotent', 'second call returns already_open', r2.ok && r2.rows[0].r.charged_by === 'already_open', r2.error || JSON.stringify(r2.rows[0].r))
  ok('T5 idempotent', 'second call changes nothing (opened_at / updated_at identical)', JSON.stringify(s1) === JSON.stringify(s2))
  ok('T5 idempotent', 'old with_billing on an already-open session does not charge either', (await (async () => {
    const x = await as(db, user(U.host), `select public.kb_open_registration_with_billing($1) r`, [S.hostDraft])
    return x.ok && x.rows[0].r.charged_by === 'already_open'
  })()))
  const r3 = await as(db, user(U.host), `select public.kb_open_registration_no_charge($1) r`, [S.assigned])
  ok('T5 idempotent', 'invalid status (assigned) → INVALID_SESSION_STATUS', !r3.ok && /INVALID_SESSION_STATUS/.test(r3.error), r3.error)
  const r4 = await as(db, user(U.host), `select public.kb_open_registration_no_charge($1) r`, ['b0000000-0000-4000-8000-0000000000ff'])
  ok('T5 idempotent', 'unknown session → SESSION_NOT_FOUND', !r4.ok && /SESSION_NOT_FOUND/.test(r4.error), r4.error)
  ok('T6 balances', 'all wallet balances / txns / quota identical to initial snapshot', JSON.stringify(await snapshot()) === JSON.stringify(snap0), JSON.stringify(await snapshot()))
}

// ---------- Test 7: 02 after the new App ----------
try { await db.exec(sqlFile('02_phase2_pause_billing_rpcs.sql')); ok('T7 phase 2', '02 applies cleanly', true) }
catch (e) { ok('T7 phase 2', '02 applies cleanly', false, e.message) }
{
  const a = await as(db, user(U.host), `select public.kb_open_registration_with_billing($1) r`, [S.pending])
  ok('T7 phase 2', 'old with_billing is now denied (old App must be gone before 02)', denied(a), a.error || '')
  const b = await as(db, user(U.host), `select public.kb_open_registration_no_charge($1) r`, [S.pending])
  ok('T7 phase 2', 'new App path (no_charge) still works after 02', b.ok, b.error || '')
  for (const fn of ['kb_get_quota_dashboard', 'kb_ensure_my_billing_account', 'kb_admin_adjust_user_wallet']) {
    const r = await db.query(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p where proname = $1`, [fn])
    ok('T7 phase 2', `${fn} not executable by authenticated`, r.rows[0].x === false)
  }
  const core = await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array['lock_round_and_increment_counters','user_can_access_session','is_platform_admin','kb_admin_get_kpis'])`)
  ok('T7 phase 2', 'core session / RLS helper functions still executable by authenticated', core.rows.length > 0 && core.rows.every((x) => x.x), JSON.stringify(core.rows))
  try { await db.exec(sqlFile('03_verify_readonly.sql')); ok('T7 phase 2', '03 verify runs after 02', true) } catch (e) { ok('T7 phase 2', '03 verify runs after 02', false, e.message) }
  ok('T7 phase 2', 'balances unchanged after 02', JSON.stringify(await snapshot()) === JSON.stringify(snap0))
}

// ---------- Test 8: rollbacks ----------
const stillLocked = async (label) => {
  const r1 = await as(db, anon, debitSql, [hostBa, U.attacker])
  const r2 = await as(db, user(U.attacker), `update public.kb_wallets set balance_cents = 1`)
  const r3 = await as(db, user(U.attacker), `select public.kb_user_self_wallet_topup(20000)`)
  ok('T8 rollback', `${label}: debit / direct wallet write / self-topup remain blocked`, denied(r1) && denied(r2) && denied(r3), [r1.error, r2.error, r3.error].join(' | '))
}
try { await db.exec(sqlFile('99a_rollback_phase2.sql')); ok('T8 rollback', '99a applies', true) } catch (e) { ok('T8 rollback', '99a applies', false, e.message) }
{
  const a = await as(db, user(U.host), `select public.kb_open_registration_with_billing($1) r`, [S.pending])
  ok('T8 rollback', '99a: old with_billing callable again', a.ok, a.error || '')
  await stillLocked('99a')
}
try { await db.exec(sqlFile('99b_rollback_phase1_safe.sql')); ok('T8 rollback', '99b applies', true) } catch (e) { ok('T8 rollback', '99b applies', false, e.message) }
{
  const b = await as(db, user(U.host), `select public.kb_open_registration_no_charge($1) r`, [S.pending])
  ok('T8 rollback', '99b: no_charge dropped (new App would show NO_CHARGE_RPC_NOT_DEPLOYED)', !b.ok && /does not exist/.test(b.error), b.error)
  await stillLocked('99b')
}
try { await db.exec(sqlFile('99b_rollback_phase1_safe.sql')); ok('T8 rollback', '99b is re-runnable', true) } catch (e) { ok('T8 rollback', '99b is re-runnable', false, e.message) }
// 99z on a separate transaction: prove it is UNSAFE (re-exposes), then roll it back
{
  const z = await db.transaction(async (tx) => {
    await tx.exec(sqlFile('99z_restore_pre092_acl_UNSAFE.sql').replace(/^\s*begin;\s*$/m, '').replace(/^\s*commit;\s*$/m, ''))
    await tx.exec('set local role anon')
    const r = await tx.query(`select has_function_privilege('anon', 'public.kb_wallet_debit_cents(uuid,bigint,uuid,kb_wallet_txn_reason,text,uuid,text,jsonb)', 'execute') x`)
    await tx.rollback()
    return r.rows[0].x
  }).catch((e) => 'ERR ' + e.message)
  ok('T8 rollback', '99z (UNSAFE) indeed re-exposes kb_wallet_debit_cents to anon — must never be the default rollback', z === true, String(z))
}
try { await db.exec(sqlFile('01_phase1_lockdown_and_no_charge_open.sql')); await stillLocked('re-apply 01 after rollback') } catch (e) { ok('T8 rollback', 're-apply 01', false, e.message) }
ok('T8 rollback', 'balances unchanged after all rollbacks', JSON.stringify(await snapshot()) === JSON.stringify(snap0))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
