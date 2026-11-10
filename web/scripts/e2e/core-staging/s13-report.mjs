import { chromium, W, admin, ok, settle, shot, load } from './lib.mjs'
import { hostPage } from './hostpage.mjs'
const st = load()
const b = await chromium.launch({ channel: 'chrome', headless: true })
const { page } = await hostPage(b)
await page.locator('button', { hasText: '結束場次' }).first().click(); await settle(page, 2500)
const dlg = page.locator('[role=dialog], [class*=modal]').last()
console.log('  modal:', (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 400))
console.log('  modal buttons:', (await dlg.locator('button').allInnerTexts()).join(' | '))
await shot(page, '21-report-modal')
// 未繳費警告：先按「仍要結束」類按鈕（若有）
const cont = dlg.locator('button', { hasText: /仍要|繼續|略過|我知道/ })
if (await cont.count()) { console.log('  unpaid warning → click', await cont.first().innerText()); await cont.first().click(); await settle(page, 800) }
const fill = async (id, v) => { const el = page.locator(`#${id}`); if (await el.count()) { await el.fill(String(v)) } }
await fill('ap', 3); await fill('af', 200); await fill('vc', 400); await fill('su', 2); await fill('sc', 50); await fill('oi', 0); await fill('oe', 0); await fill('nt', 'M8 驗收')
await shot(page, '22-report-filled')
console.log('  modal buttons now:', (await dlg.locator('button').allInnerTexts()).join(' | '))
await dlg.locator('button.btn-primary').last().click(); await settle(page, 4000)
const s = (await admin(`/rest/v1/sessions?id=eq.${st.sessionId}&select=status`)).j[0]
const rep = (await admin(`/rest/v1/session_operation_reports?session_id=eq.${st.sessionId}&select=*`)).j
ok('11 結束場次並建立營運報表', s.status === 'session_finished' && rep.length === 1, JSON.stringify({ s, rep: rep.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => /cents|players|profit|income|expense|note/.test(k)))) }))
console.log('errors:', page.errs)
// 營運報表頁
await page.goto(`${W}/dashboard/operations`); await settle(page, 3500)
const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const i = t.indexOf('M8 測試場次')
console.log('  operations page:', t.slice(Math.max(0, i - 200), i + 400))
ok('11 營運報表頁顯示該場次報表', i >= 0)
await shot(page, '23-operations')
const api = await page.evaluate(async () => { const r = await fetch('/api/dashboard/operations/reports'); return { s: r.status, j: await r.json() } })
console.log('  reports API:', api.s, JSON.stringify(api.j).slice(0, 400))
console.log('errors:', page.errs)
await b.close()
