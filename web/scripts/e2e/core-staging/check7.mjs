import { admin, ok, load, save } from './lib.mjs'
const st = load()
const rounds = (await admin(`/rest/v1/rounds?session_id=eq.${st.sessionId}&select=id,round_no,court_no,status,locked_at,finished_at`)).j
const matches = (await admin(`/rest/v1/matches?session_id=eq.${st.sessionId}&select=id,round_id,match_label,court_no,final_score_team_1,final_score_team_2,winning_team_no`)).j
const teams = (await admin(`/rest/v1/match_teams?select=*,match_team_players(*)&match_id=in.(${matches.map((m) => m.id).join(',')})`)).j
console.log(JSON.stringify({ rounds, matches }), '\nteams:', JSON.stringify(teams).slice(0, 600))
const nPlayers = teams.reduce((n, t) => n + (t.match_team_players?.length || 0), 0)
ok('7 建立排組（草稿 round、1 場比賽、2 隊 4 人）', rounds.length === 1 && rounds[0].status === 'draft' && matches.length === 1 && teams.length === 2 && nPlayers === 4, `rounds=${rounds.length}/${rounds[0]?.status} matches=${matches.length} teams=${teams.length} players=${nPlayers}`)
st.roundId = rounds[0]?.id; st.matchId = matches[0]?.id; save(st)
