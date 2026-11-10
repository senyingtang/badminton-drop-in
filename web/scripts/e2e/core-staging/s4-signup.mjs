import { chromium, W, admin, load, save, browserCtx, login, body, shot, settle, ok } from './lib.mjs'
const st = load()
const b = await chromium.launch({ channel: 'chrome', headless: true })
const errs = []
for (let i = 0; i < 4; i++) {
  const pl = st.players[i]
  const ctx = await browserCtx(b); const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  p.on('response', (r) => { if (r.status() >= 400) errs.push(`p${i + 1} ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '')}`) })
  await login(p, pl.email)
  await p.goto(`${W}/s/${st.code}`); await settle(p, 2500)
  const ens = p.locator('button', { hasText: '建立球員資料' })
  if (await ens.count()) { await ens.click(); await settle(p, 3000) }
  await p.fill('#oneTimeName', pl.name)
  await p.locator('button', { hasText: '送出自己報名' }).click()
  await settle(p, 4000)
  const t = await body(p)
  console.log(`p${i + 1}:`, t.match(/報名人數[^💰]*/)?.[0], '|', t.match(/正選 \(\d+\)[^報]*/)?.[0]?.slice(0, 160))
  if (i === 0) { await shot(p, '07-after-signup'); console.log('buttons:', await p.locator('button').allInnerTexts()) }
  await ctx.storageState({ path: `./p${i + 1}-state.json` }); await ctx.close()
}
const parts = (await admin(`/rest/v1/session_participants?session_id=eq.${st.sessionId}&select=id,player_id,status,source_type,is_waitlist,priority_order,waitlist_order,session_display_name&order=created_at`)).j
console.log(JSON.stringify(parts, null, 0))
console.log('errors:', errs)
await b.close()
