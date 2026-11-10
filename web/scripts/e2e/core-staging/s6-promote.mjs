import { chromium, admin, ok, settle, shot } from './lib.mjs'
import { hostPage } from './hostpage.mjs'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const { page, st } = await hostPage(b)
const parts = async () => (await admin(`/rest/v1/session_participants?session_id=eq.${st.sessionId}&select=id,status,session_display_name,waitlist_order&order=created_at`)).j
await page.locator('button', { hasText: '遞補下一位' }).click(); await settle(page, 3000)
const ps = await parts(); const p4 = ps.find((x) => x.session_display_name === 'M8球友4')
ok('6 候補遞補（⬆ 遞補下一位，套用 094 後）', p4?.status === 'promoted_from_waitlist', p4?.status)
const prom = (await admin(`/rest/v1/session_waitlist_promotions?session_id=eq.${st.sessionId}&select=reason,promoted_participant_id`)).j
const notif = (await admin(`/rest/v1/kb_notifications?user_id=eq.${st.players[3].id}&select=title`)).j
ok('6 遞補紀錄與站內通知已寫入（不發 LINE）', prom.length === 1 && notif.length === 1, JSON.stringify({ prom: prom.length, notif }))
console.log('  UI shows:', (await page.locator('body').innerText()).match(/正選名單[^候]*/)?.[0]?.replace(/\s+/g, ' ').slice(0, 120))
console.log('errors:', page.errs); await shot(page, '11-promoted')
await b.close()
