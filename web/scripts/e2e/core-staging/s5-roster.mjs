import { chromium, admin, ok, settle, shot } from './lib.mjs'
import { hostPage } from './hostpage.mjs'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const { page, st } = await hostPage(b)
const parts = async () => (await admin(`/rest/v1/session_participants?session_id=eq.${st.sessionId}&select=id,status,source_type,waitlist_order,is_paid:paid_at,session_display_name,player_id&order=created_at`)).j
const byName = (ps, n) => ps.find((x) => (x.session_display_name || '').includes(n))
console.log(JSON.stringify(await parts()))
const btnIn = (name, title) => page.locator(`button[title="${title}"]`).filter({ has: page.locator('xpath=.') }).and(page.locator(`xpath=//button[@title="${title}"][ancestor::*[contains(normalize-space(.), "${name}") and string-length(normalize-space(.)) < 300]]`)).first()
// 4 取消報名（團主取消 p2）
await btnIn('M8球友2', '取消').click(); await settle(page, 3000)
let ps = await parts()
ok('4 取消報名（團主取消，名單即時更新）', byName(ps, 'M8球友2')?.status === 'cancelled', byName(ps, 'M8球友2')?.status)
const p4After = byName(ps, 'M8球友4')?.status
console.log('  候補 p4 after cancel:', p4After)
await shot(page, '08-after-cancel')
// 6 候補遞補
if (p4After === 'waitlist') { await page.locator('button', { hasText: '遞補下一位' }).click(); await settle(page, 3000); ps = await parts() }
ok('6 候補遞補（取消後由候補補上正選）', ['promoted_from_waitlist', 'confirmed_main'].includes(byName(ps, 'M8球友4')?.status), `${p4After} → ${byName(ps, 'M8球友4')?.status}`)
// 5 手動代報名（建立新球員並加入）
await page.locator('button', { hasText: '新增球員' }).first().click(); await settle(page, 1000)
await shot(page, '09-add-modal')
const createBtn = page.locator('button', { hasText: /建立新球員|新增新球員|建立/ }).first()
console.log('  modal buttons:', (await page.locator('[role=dialog] button, [class*=modal] button').allInnerTexts()).join(' | '))
await createBtn.click(); await settle(page, 500)
await page.fill('input[placeholder="球員代碼（英數字）*"]', 'm8guest' + Date.now().toString().slice(-5))
await page.fill('input[placeholder="顯示名稱 *"]', 'M8代報名')
await page.fill('input[placeholder="級數（1-18，選填）"]', '5')
console.log('  modal buttons:', (await page.locator('[class*=modal] button').allInnerTexts()).join(' | '))
await page.locator('[class*=modal] button', { hasText: /建立並加入|加入/ }).last().click(); await settle(page, 3000)
ps = await parts()
const g = ps.find((x) => x.source_type === 'host_manual')
ok('5 手動代報名（建立球員並加入名單）', Boolean(g) && ['confirmed_main', 'promoted_from_waitlist'].includes(g.status), JSON.stringify(g))
st.parts = ps; (await import('./lib.mjs')).save(st)
console.log(JSON.stringify(ps))
console.log('errors:', page.errs)
await shot(page, '10-after-add')
await b.close()
