import { chromium, admin, ok, settle, shot, load } from './lib.mjs'
import { hostPage } from './hostpage.mjs'
const st = load()
const b = await chromium.launch({ channel: 'chrome', headless: true })
const { page } = await hostPage(b)
const btns = async () => (await page.locator('button').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ')).filter(Boolean).filter((s) => !/^(聯絡|已繳費|下輪離場|⏸|⏳|✕|標記已繳費)$/.test(s) && !/Lv\./.test(s))
await page.locator('button', { hasText: '結束本輪' }).first().click(); await settle(page, 3500)
const r = (await admin(`/rest/v1/rounds?id=eq.${st.roundId}&select=status,finished_at`)).j[0]
const sp = (await admin(`/rest/v1/session_participants?session_id=eq.${st.sessionId}&select=is_locked_for_current_round&is_locked_for_current_round=eq.true`)).j
console.log('  round:', JSON.stringify(r), 'still locked participants:', sp.length, '| session:', (await admin(`/rest/v1/sessions?id=eq.${st.sessionId}&select=status`)).j[0].status)
console.log('buttons:', (await btns()).join(' | '))
console.log('errors:', page.errs); await shot(page, '20-round-finished')
await b.close()
