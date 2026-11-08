// Build a Supabase-like Postgres (PGlite) from the repo's real migrations.
// Usage (module): const db = await bootstrap({ docsDir, verbose })
import { PGlite } from '@electric-sql/pglite'


import fs from 'node:fs'
import path from 'node:path'

// Migrations relevant to sessions + billing, in PROD_SQL_RUN_ORDER order.
export const MIGRATIONS = [
  '001_base_schema.sql', '002_rls_policies.sql', '003_seed_plans_and_defaults.sql', '004_functions_and_triggers.sql',
  '005_billing_schema.sql', '005_rpc_and_views.sql', '006_phase6_schema.sql', '007_phase7_schema.sql',
  '007_phase8_public_signup_rls.sql', '009_fix_sessions_rls_recursion.sql', '010_fix_sessions_players_rls_recursion.sql',
  '012_public_sessions_policy_statuses.sql', '014_rls_scope_policies_by_role.sql',
  '026_kb_resolve_billing_account_autocreate.sql', '027_kb_admin_get_kpis_fix.sql', '028_kb_wallet_admin_and_self_topup.sql',
  '033_kb_get_quota_dashboard_fallback.sql', '047_fix_lock_round_new_billing.sql',
  '048_billing_open_registration_wallet_subscription.sql', '049_update_monthly_overage_to_50.sql',
  '050_fix_plan_entitlements_updated_at_and_overage.sql', '051_admin_manual_subscription_and_billing_function_fix.sql',
  '052_fix_open_registration_v_ent_variable.sql', '053_fix_quota_bucket_period_columns_and_admin_quota.sql',
]

// Minimal Supabase platform: roles, auth schema, auth.uid(), default privileges (as on hosted Supabase).
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claim.sub', true), ''), 'null')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage, create on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

export async function bootstrap({ docsDir, verbose = false, dataDir } = {}) {
  const db = new PGlite(dataDir)
  await db.exec(SUPABASE_STUB)
  const load = (f) => fs.readFileSync(path.join(docsDir, f), 'utf8')
    .replace(/create extension if not exists pgcrypto;/gi, '-- (pgcrypto: gen_random_uuid is core in PG13+)')
    .replace(/create extension if not exists citext;/gi, "do $c$ begin if to_regtype('public.citext') is null then create domain public.citext as text; end if; end $c$;")
  const run = async (files, label) => {
    const errs = []
    for (const f of files) {
      try { await db.exec(load(f)); if (verbose) console.log(`ok   ${label} ${f}`) }
      catch (e) { errs.push({ file: f, error: e.message }); if (verbose) console.log(`ERR  ${label} ${f} - ${e.message}`); try { await db.exec('rollback') } catch {} }
    }
    return errs
  }
  // Pass 1 in prod order; pass 2 retries files that depended on later enum values / columns
  // (prod has been re-run repeatedly, so the final function/policy versions are what matter).
  const first = await run(MIGRATIONS, 'p1')
  const retry = first.map((e) => e.file).filter((f) => f !== '005_rpc_and_views.sql')
  const second = await run(retry, 'p2')
  // Re-apply the latest definitions so overload/ordering matches the newest migration.
  const third = await run(['051_admin_manual_subscription_and_billing_function_fix.sql', '052_fix_open_registration_v_ent_variable.sql', '053_fix_quota_bucket_period_columns_and_admin_quota.sql'], 'p3')
  const errors = [...second, ...third, ...first.filter((e) => e.file === '005_rpc_and_views.sql')]
  return { db, errors }
}

// Run fn as a Supabase role with a JWT subject, inside a transaction that is always rolled back
// unless commit=true. Returns {ok, rows|error}.
export async function as(db, { role, sub = null }, sqlText, params = [], { commit = false } = {}) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [sub ?? '', role])
    let out
    try { const r = await tx.query(sqlText, params); out = { ok: true, rows: r.rows, affected: r.affectedRows } }
    catch (e) { out = { ok: false, error: e.message, code: e.code } }
    if (!commit || !out.ok) await tx.rollback()
    return out
  })
}
