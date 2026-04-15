/**
 * 讀取 repo 根目錄 .env 的 DATABASE_URL，檢查 migration 相關 schema（不印出連線字串或密碼）。
 * 用法：在 web 目錄執行 `npm run db:inspect`
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadRootEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env')
  const out = {}
  if (!fs.existsSync(envPath)) {
    console.error('找不到專案根目錄 .env：', envPath)
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}

async function main() {
  const env = loadRootEnv()
  const url = env.DATABASE_URL
  if (!url) {
    console.error('根目錄 .env 缺少 DATABASE_URL')
    process.exit(1)
  }

  function directUrlFromPooler(poolerUrl) {
    try {
      const u = new URL(poolerUrl)
      const pass = u.password
      const user = decodeURIComponent(u.username || '')
      const m = user.match(/^postgres\.(.+)$/)
      if (!m || !pass) return null
      const ref = m[1]
      return `postgresql://postgres:${encodeURIComponent(pass)}@db.${ref}.supabase.co:5432/postgres`
    } catch {
      return null
    }
  }

  const candidates = [url]
  const alt = directUrlFromPooler(url)
  if (alt && alt !== url) candidates.push(alt)

  let client
  let lastErr
  for (const conn of candidates) {
    const c = new pg.Client({
      connectionString: conn,
      ssl: conn.includes('supabase') ? { rejectUnauthorized: false } : undefined,
      statement_timeout: 15000,
    })
    try {
      await c.connect()
      client = c
      if (conn !== url) console.error('（已改用 db.<ref>:5432 直連；請在 .env 確認 DATABASE_URL 是否應改為 Session/Direct 字串）')
      break
    } catch (e) {
      lastErr = e
      try {
        await c.end()
      } catch {
        /* ignore */
      }
    }
  }

  if (!client) {
    console.error('連線失敗：請到 Supabase Dashboard → Database 複製「Direct connection」或 Session pooler 連線字串更新根目錄 .env 的 DATABASE_URL。')
    console.error(lastErr instanceof Error ? lastErr.message : lastErr)
    process.exit(1)
  }

  const checks = []

  const col = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name=$1 and column_name=$2`,
    ['rounds', 'court_no']
  )
  checks.push({ item: 'rounds.court_no', ok: col.rows.length > 0 })

  const col2 = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name=$1 and column_name=$2`,
    ['assignment_recommendations', 'court_no']
  )
  checks.push({ item: 'assignment_recommendations.court_no', ok: col2.rows.length > 0 })

  const fn = await client.query(
    `select p.proname,
            pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'kb_ensure_my_billing_account',
         'kb_get_quota_dashboard',
         'apply_assignment_recommendation_and_create_round',
         'list_session_participants_for_host'
       )
     order by p.proname, args`
  )
  const byName = {}
  for (const r of fn.rows) {
    if (!byName[r.proname]) byName[r.proname] = []
    byName[r.proname].push(r.args)
  }

  const applyArgs = byName['apply_assignment_recommendation_and_create_round'] || []
  const listArgs = byName['list_session_participants_for_host'] || []

  checks.push({
    item: '033 kb_ensure_my_billing_account()',
    ok: Array.isArray(byName['kb_ensure_my_billing_account']) && byName['kb_ensure_my_billing_account'].length > 0,
  })
  checks.push({
    item: '030 apply_assignment…（須含 input_court_no）',
    ok: applyArgs.some((a) => /input_court_no/i.test(a)),
  })
  checks.push({
    item: '032 list_session_participants_for_host 仍存在',
    ok: listArgs.length > 0,
  })

  const legacyApply = await client.query(
    `select pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='apply_assignment_recommendation_and_create_round'
       and p.pronargs = 3`
  )
  checks.push({
    item: '若存在三參數 apply_assignment，須同時具備四參數版本（030；035 為可選相容）',
    ok: legacyApply.rows.length === 0 || applyArgs.some((a) => /input_court_no/i.test(a)),
  })

  const fnMap = {}
  for (const r of fn.rows) {
    fnMap[`${r.proname}(${r.args})`] = true
  }

  console.log(JSON.stringify({ checks, functions_found: Object.keys(fnMap).sort() }, null, 2))

  const todo = []
  for (const c of checks) {
    if (!c.ok) todo.push(c.item)
  }
  if (todo.length) {
    console.log('\n建議在 Supabase SQL Editor 依 docs/SQL_MIGRATION_ORDER.md 補跑對應檔案。未通過項目：')
    for (const t of todo) console.log(' -', t)
  } else {
    console.log('\n上述檢查皆通過（仍請以 SQL_MIGRATION_ORDER 人工核對其他檔案）。')
  }

  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
