import { chromium, W, admin, ok, settle, shot, load, browserCtx } from './lib.mjs'
import { hostPage } from './hostpage.mjs'
const st = load()
const b = await chromium.launch({ channel: 'chrome', headless: true })
let { page } = await hostPage(b)
// 8 鎖定排組
await page.locator('button', { hasText: '鎖定開打' }).first().click(); await settle(page, 3500)
let r = (await admin(`/rest/v1/rounds?id=eq.${st.roundId}&select=status,locked_at`)).j[0]
const sp = (await admin(`/rest/v1/session_participants?session_id=eq.${st.sessionId}&select=session_display_name,total_matches_played,is_locked_for_current_round&status=neq.cancelled`)).j
ok('8 鎖定排組（round=locked、上場者計數 +1、鎖定旗標）', r.status === 'locked' && sp.filter((x) => x.total_matches_played === 1).length === 4 && sp.filter((x) => x.is_locked_for_current_round).length === 4, JSON.stringify({ r, sp: sp.map((x) => `${x.session_display_name || 'host/guest'}:${x.total_matches_played}/${x.is_locked_for_current_round}`) }))
console.log('errors:', page.errs); await shot(page, '16-locked')
// 9a 球友回報比分（/my-matches）
const teams = (await admin(`/rest/v1/match_teams?match_id=eq.${st.matchId}&select=team_no,match_team_players(participant_id)`)).j
const partIds = teams.flatMap((t) => t.match_team_players.map((x) => x.participant_id))
const parts = (await admin(`/rest/v1/session_participants?id=in.(${partIds.join(',')})&select=id,player_id,session_display_name`)).j
const reporter = st.players.find((p) => parts.some((x) => x.session_display_name === p.name))
console.log('reporter:', reporter?.name)
const pc = await browserCtx(b); const pp = await pc.newPage(); pp.on('dialog', (d) => { console.log('  P-DIALOG:', d.message()); d.accept() })
const perrs = []; pp.on('response', (x) => { if (x.status() >= 400) perrs.push(`${x.status()} ${x.request().method()} ${x.url().replace(/\?.*/, '')}`) })
const { login } = await import('./lib.mjs'); await login(pp, reporter.email)
await pp.goto(`${W}/my-matches`); await settle(pp, 3000)
console.log('  my-matches:', (await pp.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300))
const inputs = pp.locator('input[type=number]')
if ((await inputs.count()) >= 2) { await inputs.nth(0).fill('21'); await inputs.nth(1).fill('17'); await pp.locator('button', { hasText: '送出比分' }).click(); await settle(pp, 3000) }
const subs = (await admin(`/rest/v1/match_score_submissions?match_id=eq.${st.matchId}&select=score_team_1,score_team_2,status,submitted_by_player_id`)).j
ok('9 比分回報（球友於 /my-matches 回報）', subs.length === 1 && subs[0].score_team_1 === 21 && subs[0].status === 'submitted', JSON.stringify(subs) + ' ' + perrs.join(','))
const hn = (await admin(`/rest/v1/kb_notifications?user_id=eq.${st.host.id}&select=title`)).j
console.log('  host notifications:', JSON.stringify(hn))
await shot(pp, '17-my-matches')
// 9b 團主一鍵採納
await page.reload(); await settle(page, 3500)
const adopt = page.locator('button', { hasText: '一鍵採納' })
console.log('  adopt visible:', await adopt.count(), '| text:', (await page.locator('body').innerText()).match(/球員回報：[^ \n]*/)?.[0])
if (await adopt.count()) { await adopt.first().click(); await settle(page, 3000) }
const m = (await admin(`/rest/v1/matches?id=eq.${st.matchId}&select=final_score_team_1,final_score_team_2,winning_team_no,confirmed_at`)).j[0]
const subs2 = (await admin(`/rest/v1/match_score_submissions?match_id=eq.${st.matchId}&select=status,reviewed_at`)).j
ok('9 比分採納（團主一鍵採納 → matches 寫入比分、回報標記 confirmed）', m.final_score_team_1 === 21 && m.final_score_team_2 === 17 && m.winning_team_no === 1 && subs2[0]?.status === 'confirmed', JSON.stringify({ m, subs2 }))
console.log('errors:', page.errs); await shot(page, '18-adopted')
await b.close()
