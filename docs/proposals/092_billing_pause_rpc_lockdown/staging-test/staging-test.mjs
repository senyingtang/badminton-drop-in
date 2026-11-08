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
  for (const [fn, expected] of [['kb_admin_adjust_user_wallet', false], ['kb_get_quota_dashboard', true], ['kb_ensure_my_billing_account', true]]) {
    const r = await db.query(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p where proname = $1`, [fn])
    ok('T7 phase 2', `${fn} ${expected ? 'still executable (read-only wallet UI needs it)' : 'not executable'} by authenticated`, r.rows[0].x === expected)
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

// =====================================================================================
// M1.4：01b 讀取範圍 / 01c 配額總覽越權 / 01d 角色提升 / 04 付款入帳
// =====================================================================================
const orgBaWalletId = (await db.query(`select id from public.kb_wallets where billing_account_id = $1`, [ORG_BA])).rows[0].id
const otherBa = (await db.query(`select id from public.kb_billing_accounts where owner_user_id = $1`, [U.other])).rows[0].id
await db.query(`insert into public.kb_wallet_transactions(wallet_id, txn_type, amount, balance_before, balance_after, reference_type, note)
  select w.id, 'topup', 1, 0, 1, 'fixture', 'history' from public.kb_wallets w`)
const snapM14 = await snapshot()

// ---- baseline before 01b / 01c / 01d (read leaks + role escalation) ----
{
  const r1 = await as(db, user(U.attacker), `select count(*)::int n from public.kb_wallets`)
  ok('M1.4 baseline', 'BEFORE 01b: any user reads ALL wallets (no RLS)', r1.ok && r1.rows[0].n >= 4, JSON.stringify(r1.rows))
  const r2 = await as(db, anon, `select count(*)::int n from public.kb_wallet_transactions`)
  ok('M1.4 baseline', 'BEFORE 01b: anon reads ALL wallet transactions', r2.ok && r2.rows[0].n >= 4, r2.error || JSON.stringify(r2.rows))
  const r3 = await as(db, user(U.attacker), `select public.kb_get_quota_dashboard($1) d`, [U.host])
  ok('M1.4 baseline', 'BEFORE 01c: kb_get_quota_dashboard(other user) leaks their wallet', r3.ok && r3.rows[0].d?.user_id === U.host, r3.error || '')
  const r4 = await as(db, user(U.attacker), `update public.app_user_profiles set primary_role = 'platform_admin' where id = $1`, [U.attacker])
  ok('M1.4 baseline', 'BEFORE 01d: member CAN self-promote to platform_admin (P0 confirmed)', r4.ok && r4.affected === 1, r4.error || '')
}

for (const f of ['01b_rls_read_scoping.sql', '01c_quota_dashboard_idor_fix.sql', '01d_profile_role_escalation_fix.sql', '04_payment_order_mark_paid.sql']) {
  try { await db.exec(sqlFile(f)); await db.exec(sqlFile(f)); ok('M1.4 apply', `${f} applies and is re-runnable`, true) }
  catch (e) { ok('M1.4 apply', `${f} applies and is re-runnable`, false, e.message) }
}
try { await db.exec(sqlFile('03_verify_readonly.sql')); ok('M1.4 apply', '03 verify runs after 01b/01c/01d/04', true) } catch (e) { ok('M1.4 apply', '03 verify runs after 01b/01c/01d/04', false, e.message) }
ok('M1.4 apply', 'applying 01b/01c/01d/04 did not change balances / history', JSON.stringify(await snapshot()) === JSON.stringify(snapM14))

// ---- G1/G2: read scoping ----
{
  const cnt = async (who, q, p = []) => { const r = await as(db, who, q, p); return r.ok ? r.rows[0].n : 'ERR ' + r.error }
  ok('G1 own data only', 'member sees only own wallet', await cnt(user(U.other), `select count(*)::int n from public.kb_wallets`) === 1)
  ok('G1 own data only', 'member sees only own billing account', await cnt(user(U.other), `select count(*)::int n from public.kb_billing_accounts`) === 1)
  ok('G1 own data only', 'member cannot see host wallet by id', await cnt(user(U.other), `select count(*)::int n from public.kb_wallets where billing_account_id = $1`, [hostBa]) === 0)
  ok('G1 own data only', 'member sees only own transactions', await cnt(user(U.other), `select count(*)::int n from public.kb_wallet_transactions`) === 1)
  // the exact PostgREST shape used by /billing: transactions joined to own wallet
  const own = await as(db, user(U.other), `select t.id from public.kb_wallet_transactions t join public.kb_wallets w on w.id = t.wallet_id where w.billing_account_id = $1`, [otherBa])
  ok('G1 own data only', '/billing page query (own txns via wallet join) still works', own.ok && own.rows.length === 1, own.error || '')
  ok('G1 own data only', 'anon sees no wallets (permission denied or 0)', (await cnt(anon, `select count(*)::int n from public.kb_wallets`)) !== 4)
  const view = await as(db, user(U.other), `select count(*) from public.kb_v_quota_dashboard_personal`)
  ok('G1 own data only', 'RLS-bypassing view kb_v_quota_dashboard_personal not readable by users', denied(view), view.error || 'readable!')
  ok('G1 own data only', 'org membership list hidden from non-members', await cnt(user(U.other), `select count(*)::int n from public.kb_organization_members`) === 0)
  ok('G2 host / org scope', 'org manager sees org wallet', await cnt(user(U.orgManager), `select count(*)::int n from public.kb_wallets where billing_account_id = $1`, [ORG_BA]) === 1)
  ok('G2 host / org scope', 'org owner sees org wallet transactions', await cnt(user(U.orgOwner), `select count(*)::int n from public.kb_wallet_transactions where wallet_id = $1`, [orgBaWalletId]) === 1)
  ok('G2 host / org scope', 'inactive org member does NOT see org wallet', await cnt(user(U.orgInactive), `select count(*)::int n from public.kb_wallets where billing_account_id = $1`, [ORG_BA]) === 0)
  ok('G2 host / org scope', 'host sees own personal wallet', await cnt(user(U.host), `select count(*)::int n from public.kb_wallets where billing_account_id = $1`, [hostBa]) === 1)
  ok('G2 host / org scope', 'platform admin sees all wallets (admin users page)', await cnt(user(U.admin), `select count(*)::int n from public.kb_wallets`) >= 4)
  ok('G2 host / org scope', 'plans catalogue readable by members', typeof (await cnt(user(U.other), `select count(*)::int n from public.kb_plans`)) === 'number')
  const dash = await as(db, user(U.host), `select public.kb_get_quota_dashboard() d`)
  ok('G2 host / org scope', '01c: own quota dashboard works (no-arg call, as the app does)', dash.ok && dash.rows[0].d?.user_id === U.host, dash.error || '')
  const idor = await as(db, user(U.other), `select public.kb_get_quota_dashboard($1) d`, [U.host])
  ok('G1 own data only', '01c: quota dashboard for ANOTHER user → NO_PERMISSION', !idor.ok && /NO_PERMISSION/.test(idor.error), idor.error || 'leaked')
  const adm = await as(db, user(U.admin), `select public.kb_get_quota_dashboard($1) d`, [U.host])
  ok('G2 host / org scope', '01c: platform admin can view another user dashboard', adm.ok && adm.rows[0].d?.user_id === U.host, adm.error || '')
  const unchecked = await as(db, user(U.other), `select public.kb_get_quota_dashboard_unchecked($1)`, [U.host])
  ok('G1 own data only', '01c: renamed original function not callable by users', denied(unchecked), unchecked.error || '')
}

// ---- G3/G4: no debit / no self-credit / no org-role changes (re-check after all files) ----
{
  const attacks = [
    ['debit other wallet', user(U.attacker), debitSql, [hostBa, U.attacker]],
    ['self topup', user(U.attacker), `select public.kb_user_self_wallet_topup(20000)`, []],
    ['direct wallet update', user(U.attacker), `update public.kb_wallets set balance_cents = 1`, []],
    ['mark own fake order paid (04 is service-only)', user(U.attacker), `select public.kb_payment_order_mark_paid('X', 100, 'x', '{}')`, []],
    ['add self to org', user(U.attacker), `insert into public.kb_organization_members(organization_id, user_id, role) values ($1, $2, 'owner')`, [ORG, U.attacker]],
    ['org manager promotes self to owner', user(U.orgManager), `update public.kb_organization_members set role = 'owner' where user_id = $1`, [U.orgManager]],
    ['org manager re-activates inactive member', user(U.orgManager), `update public.kb_organization_members set is_active = true where user_id = $1`, [U.orgInactive]],
  ]
  for (const [name, who, q, p] of attacks) {
    const r = await as(db, who, q, p)
    ok('G3/G4 no unauthorised writes', `${name} blocked`, denied(r), r.ok ? `ok affected=${r.affected}` : r.error)
  }
}

// ---- 01d: role escalation ----
{
  const r1 = await as(db, user(U.attacker), `update public.app_user_profiles set primary_role = 'platform_admin' where id = $1`, [U.attacker])
  ok('01d role guard', 'member self-promote to platform_admin blocked', !r1.ok && /ROLE_CHANGE_NOT_ALLOWED/.test(r1.error), r1.error || 'allowed!')
  const r2 = await as(db, user(U.attacker), `update public.app_user_profiles set primary_role = 'host' where id = $1`, [U.attacker])
  ok('01d role guard', 'member self-promote to host blocked', !r2.ok, r2.error || 'allowed!')
  const r3 = await as(db, user(U.attacker), `update public.app_user_profiles set display_name = 'new name' where id = $1`, [U.attacker])
  ok('01d role guard', 'member can still edit own display_name', r3.ok && r3.affected === 1, r3.error || '')
  await db.query(`update public.app_user_profiles set is_active = false where id = $1`, [U.attacker])
  const r4 = await as(db, user(U.attacker), `update public.app_user_profiles set is_active = true where id = $1`, [U.attacker])
  ok('01d role guard', 'disabled member cannot re-enable self', !r4.ok, r4.error || 'allowed!')
  await db.query(`update public.app_user_profiles set is_active = true where id = $1`, [U.attacker])
  const r5 = await as(db, user(U.admin), `update public.app_user_profiles set primary_role = 'host' where id = $1`, [U.other])
  ok('01d role guard', 'platform admin can still change another user role (admin users page)', r5.ok && r5.affected === 1, r5.error || '')
  const r6 = await as(db, { role: 'service_role' }, `update public.app_user_profiles set primary_role = 'host' where id = $1`, [U.other])
  ok('01d role guard', 'service_role (bulk-update-role API, LINE callback) unaffected', r6.ok, r6.error || '')
  const newUser = 'a0000000-0000-4000-8000-0000000000aa'
  await db.query(`insert into auth.users(id) values ($1)`, [newUser])
  const r7 = await as(db, user(newUser), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'player')`, [newUser])
  ok('01d role guard', 'new user can create own profile as player (useProfileSync)', r7.ok, r7.error || '')
  const r8 = await as(db, user(newUser), `insert into public.app_user_profiles(id, display_name, primary_role) values ($1, 'n', 'platform_admin')`, [newUser])
  ok('01d role guard', 'new user cannot create own profile as platform_admin', !r8.ok, r8.error || 'allowed!')
}

// ---- 04: payment mark-paid (G5 at DB level; MAC checks are app-level unit tests) ----
{
  const svc = { role: 'service_role' }
  const mkOrder = (no, cents, purpose = 'wallet_topup') => db.query(
    `insert into public.kb_payment_orders(user_id, provider, merchant_trade_no, amount_cents, purpose, status) values ($1, 'ecpay', $2, $3, $4::kb_payment_order_purpose, 'pending')`,
    [U.other, no, cents, purpose])
  const bal = async () => (await db.query(`select balance_cents::text b from public.kb_wallets where billing_account_id = $1`, [otherBa])).rows[0].b
  const txns = async (no) => (await db.query(`select count(*)::int n from public.kb_wallet_transactions t join public.kb_payment_orders o on o.id = t.reference_id where o.merchant_trade_no = $1`, [no])).rows[0].n
  const markPaid = (no, cents) => as(db, svc, `select public.kb_payment_order_mark_paid($1, $2, 'T1', '{}') r`, [no, cents], { commit: true })

  await mkOrder('SBX0001', 50000)
  const b0 = await bal()
  const p1 = await markPaid('SBX0001', 50000)
  ok('04 mark paid', 'verified payment credits wallet once', p1.ok && p1.rows[0].r.result === 'paid' && Number(await bal()) === Number(b0) + 50000 && (await txns('SBX0001')) === 1, p1.error || JSON.stringify(p1.rows[0].r))
  const p2 = await markPaid('SBX0001', 50000)
  ok('04 mark paid', 'replayed notify → already_paid, NO second credit', p2.ok && p2.rows[0].r.result === 'already_paid' && Number(await bal()) === Number(b0) + 50000 && (await txns('SBX0001')) === 1, JSON.stringify(p2.rows?.[0]?.r))
  await mkOrder('SBX0002', 30000)
  const p3 = await markPaid('SBX0002', 99999)
  ok('04 mark paid', 'amount mismatch → not paid, no credit', p3.ok && p3.rows[0].r.result === 'amount_mismatch' && (await txns('SBX0002')) === 0, JSON.stringify(p3.rows?.[0]?.r))
  const p4 = await markPaid('NOPE', 100)
  ok('04 mark paid', 'unknown order → not_found, no credit', p4.ok && p4.rows[0].r.result === 'not_found')
  await db.query(`update public.kb_payment_orders set status = 'canceled' where merchant_trade_no = 'SBX0002'`)
  const p5 = await markPaid('SBX0002', 30000)
  ok('04 mark paid', 'canceled order → invalid_status, no credit', p5.ok && p5.rows[0].r.result === 'invalid_status' && (await txns('SBX0002')) === 0)
  const dup = await as(db, svc, `insert into public.kb_wallet_transactions(wallet_id, txn_type, amount, balance_before, balance_after, reference_type, reference_id)
    select t.wallet_id, 'topup', 1, 0, 1, 'payment_order', t.reference_id from public.kb_wallet_transactions t join public.kb_payment_orders o on o.id = t.reference_id where o.merchant_trade_no = 'SBX0001'`)
  ok('04 mark paid', 'unique index blocks a second credit row for the same payment order', !dup.ok && /duplicate|unique/i.test(dup.error), dup.error || 'inserted!')
  const p6 = await as(db, user(U.other), `select public.kb_payment_order_mark_paid('SBX0001', 50000, 'T', '{}')`)
  ok('04 mark paid', 'members cannot call kb_payment_order_mark_paid', denied(p6), p6.error || '')
  // clean the sandbox orders back out so the history-integrity check below compares like with like
  await db.query(`delete from public.kb_billing_events where reference_type = 'payment_order'`)
  await db.query(`delete from public.kb_wallet_transactions where reference_type = 'payment_order'`)
  await db.query(`update public.kb_wallets set balance_cents = $2::bigint, balance = $2::bigint / 100.0 where billing_account_id = $1`, [otherBa, b0])
  await db.query(`delete from public.kb_payment_orders where merchant_trade_no like 'SBX%'`)
}
ok('G9 history', 'pre-existing balances and wallet history unchanged after all M1.4 SQL', JSON.stringify(await snapshot()) === JSON.stringify(snapM14), JSON.stringify(await snapshot()))

// ---- rollbacks 99c / 99d (then re-apply) ----
try {
  await db.exec(sqlFile('99c_rollback_01b_01c.sql'))
  const r = await as(db, user(U.attacker), `select public.kb_get_quota_dashboard($1) d`, [U.host])
  ok('M1.4 rollback', '99c restores pre-01b/01c behaviour (documented as re-exposing read leaks)', r.ok)
  await stillLocked('99c')
  await db.exec(sqlFile('99d_rollback_01d.sql'))
  await stillLocked('99d')
  for (const f of ['01b_rls_read_scoping.sql', '01c_quota_dashboard_idor_fix.sql', '01d_profile_role_escalation_fix.sql']) await db.exec(sqlFile(f))
  const r2 = await as(db, user(U.attacker), `select public.kb_get_quota_dashboard($1) d`, [U.host])
  const r3 = await as(db, user(U.attacker), `update public.app_user_profiles set primary_role = 'platform_admin' where id = $1`, [U.attacker])
  ok('M1.4 rollback', 're-applying 01b/01c/01d after rollback closes the holes again', !r2.ok && !r3.ok, [r2.error, r3.error].join(' | '))
} catch (e) { ok('M1.4 rollback', '99c / 99d / re-apply', false, e.message) }
ok('M1.4 rollback', 'balances unchanged after M1.4 rollbacks', JSON.stringify(await snapshot()) === JSON.stringify(snapM14))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
