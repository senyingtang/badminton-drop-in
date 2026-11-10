import { chromium, admin, ok, settle, shot, save } from './lib.mjs'
import { hostPage } from './hostpage.mjs'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const { page, st } = await hostPage(b)
const btns = async () => (await page.locator('button').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ')).filter(Boolean)
await page.locator('button', { hasText: '產生第一輪排組' }).click(); await settle(page, 2500)
console.log('after generate:', (await btns()).slice(-12).join(' | '))
await shot(page, '13-preview')
const confirm = page.locator('button', { hasText: /確認排組|確認並建立|建立排組|套用/ })
console.log('confirm candidates:', await confirm.allInnerTexts())
if (await confirm.count()) { await confirm.first().click(); await settle(page, 3500) }
let rounds = (await admin(`/rest/v1/rounds?session_id=eq.${st.sessionId}&select=id,round_no,court_no,status`)).j
let matches = rounds.length ? (await admin(`/rest/v1/matches?round_id=eq.${rounds[0].id}&select=id,match_label,status`)).j : []
let assigns = rounds.length ? (await admin(`/rest/v1/match_assignments?select=id,match_id,side_no,session_participant_id&match_id=in.(${matches.map((m) => m.id).join(',') || '00000000-0000-0000-0000-000000000000'})`)) : { j: [] }
ok('7 建立排組（草稿 round + match + 4 人分配）', rounds.length === 1 && matches.length >= 1 && (assigns.j?.length || 0) === 4, JSON.stringify({ rounds, matches: matches.length, assigns: assigns.j?.length ?? assigns }))
console.log('after confirm:', (await btns()).slice(-14).join(' | '))
st.roundId = rounds[0]?.id; st.matchId = matches[0]?.id; save(st)
console.log('errors:', page.errs); await shot(page, '14-draft')
await b.close()
