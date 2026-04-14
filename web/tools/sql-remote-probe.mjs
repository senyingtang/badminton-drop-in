/**
 * 以 .env.local 的 NEXT_PUBLIC_* 連線，用 REST 探測「可能尚未套用」的 schema／函式。
 * 不會輸出任何金鑰；僅供本機診斷。
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env.local')

function loadEnvLocal() {
  if (!fs.existsSync(envPath)) {
    console.error('找不到 web/.env.local')
    process.exit(1)
  }
  const raw = fs.readFileSync(envPath, 'utf8')
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = loadEnvLocal()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

function classify(err) {
  if (!err) return 'ok'
  const m = err.message || String(err)
  if (/column .* does not exist|42703/i.test(m)) return 'missing_column'
  if (/function .* does not exist|Could not find the function|PGRST202/i.test(m)) return 'missing_function'
  if (/42501|permission denied|RLS|row-level security/i.test(m)) return 'rls_or_forbidden'
  return 'other'
}

async function main() {
  const lines = []

  const rRound = await sb.from('rounds').select('court_no').limit(1)
  lines.push({
    check: '029 rounds.court_no 可選',
    result: rRound.error ? classify(rRound.error) : 'column_exists',
    hint: rRound.error?.message?.slice(0, 120),
  })

  const rAr = await sb.from('assignment_recommendations').select('court_no').limit(1)
  lines.push({
    check: '029 assignment_recommendations.court_no 可選',
    result: rAr.error ? classify(rAr.error) : 'column_exists',
    hint: rAr.error?.message?.slice(0, 120),
  })

  const dash = await sb.rpc('kb_get_quota_dashboard')
  const dashErr = dash.error?.message || ''
  lines.push({
    check: 'kb_get_quota_dashboard（匿名僅能確認函式是否存在）',
    result: /NO_USER|unauthorized/i.test(dashErr)
      ? 'needs_login_not_missing_fn'
      : dash.error
        ? classify(dash.error)
        : dash.data
          ? 'returns_data'
          : 'returns_null',
    hint: dashErr.slice(0, 120),
  })

  const ensure = await sb.rpc('kb_ensure_my_billing_account')
  const ensureErr = ensure.error?.message || ''
  lines.push({
    check: 'kb_ensure_my_billing_account（033）',
    result: /unauthorized/i.test(ensureErr) ? 'needs_login_not_missing_fn' : ensure.error ? classify(ensure.error) : 'function_exists',
    hint: ensureErr.slice(0, 120),
  })

  const listRpc = await sb.rpc('list_session_participants_for_host', {
    input_session_id: '00000000-0000-0000-0000-000000000001',
  })
  const listErr = listRpc.error?.message || ''
  lines.push({
    check: 'list_session_participants_for_host',
    result: /unauthorized/i.test(listErr) ? 'needs_login_not_missing_fn' : listRpc.error ? classify(listRpc.error) : 'callable',
    hint: listErr.slice(0, 120),
  })

  console.log(JSON.stringify({ projectHost: new URL(url).host, lines }, null, 2))

  const suggest = []
  if (lines[0].result === 'missing_column') suggest.push('執行 docs/029_rounds_per_court_migration.sql')
  if (lines[1].result === 'missing_column') suggest.push('執行 docs/029_rounds_per_court_migration.sql（assignment_recommendations）')
  if (lines[3].result === 'missing_function') suggest.push('執行 docs/033_kb_get_quota_dashboard_fallback.sql')
  if (lines[2].result === 'returns_null' && !dash.error) suggest.push('kb_get_quota_dashboard 回傳 null：建議執行 docs/033_kb_get_quota_dashboard_fallback.sql')
  if (lines[2].result === 'other' && dash.error && !/NO_USER|unauthorized/i.test(dash.error.message || ''))
    suggest.push('kb_get_quota_dashboard 異常：' + (dash.error.message || '').slice(0, 80))

  if (suggest.length) {
    console.log('\n建議在 Supabase SQL Editor 依序補跑：\n' + [...new Set(suggest)].map((s) => '- ' + s).join('\n'))
  } else {
    console.log('\n未偵測到明顯缺欄／缺函式（仍建議對照 docs/SQL_MIGRATION_ORDER.md 人工確認）。')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
