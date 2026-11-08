// Read-only preview filter: every write path to Supabase must be denied; reads allowed; RPCs become GET.
import { filterSupabaseRequest, READ_RPC_ALLOWLIST } from '../../src/lib/readonly/readonlyPreview.ts'

const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} readonly: ${name}${detail && !pass ? ' — ' + detail : ''}`) }
const f = (m, p, q = '', b = null) => filterSupabaseRequest(m, p, q, b)

ok('table GET allowed', f('GET', '/rest/v1/sessions', '?select=*').action === 'allow')
ok('table HEAD allowed', f('HEAD', '/rest/v1/sessions').action === 'allow')
for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) ok(`table ${m} denied`, f(m, '/rest/v1/session_participants', '', '{}').action === 'deny')
for (const fn of ['self_signup_to_session_by_share_code', 'kb_wallet_debit_cents', 'kb_admin_adjust_user_wallet', 'host_set_participant_paid_status',
  'lock_round_and_increment_counters', 'kb_open_registration_with_billing', 'kb_payment_order_mark_paid', 'session_prepare_for_host', 'kb_ensure_my_billing_account'])
  ok(`write rpc ${fn} denied`, f('POST', `/rest/v1/rpc/${fn}`, '', '{}').action === 'deny')
const r = f('POST', '/rest/v1/rpc/get_public_session_roster_by_share_code', '', JSON.stringify({ p_share_code: 'AB12', p_viewer_player_id: null, p_viewer_user_id: 'u1' }))
ok('allowlisted rpc POST → GET with args (nulls dropped)', r.action === 'rpc_as_get' && r.url === '/rest/v1/rpc/get_public_session_roster_by_share_code?p_share_code=AB12&p_viewer_user_id=u1', JSON.stringify(r))
ok('allowlisted rpc with object arg denied', f('POST', '/rest/v1/rpc/kb_get_quota_dashboard', '', '{"x":{"a":1}}').action === 'deny')
ok('allowlisted rpc via PATCH denied', f('PATCH', '/rest/v1/rpc/kb_get_quota_dashboard', '', '{}').action === 'deny')
ok('allowlist contains no write-sounding names', [...READ_RPC_ALLOWLIST].every((n) => !/(insert|update|delete|set_|create|ensure|adjust|debit|topup|mark|lock|finish|cancel|signup|register|promote|confirm|move|unlock|prepare)/.test(n)))
ok('auth password login allowed', f('POST', '/auth/v1/token', '?grant_type=password').action === 'allow')
ok('auth refresh allowed', f('POST', '/auth/v1/token', '?grant_type=refresh_token').action === 'allow')
ok('auth get user allowed', f('GET', '/auth/v1/user').action === 'allow')
ok('auth logout allowed', f('POST', '/auth/v1/logout').action === 'allow')
for (const [m, p, q] of [['POST', '/auth/v1/signup', ''], ['PUT', '/auth/v1/user', ''], ['POST', '/auth/v1/recover', ''], ['POST', '/auth/v1/otp', ''],
  ['POST', '/auth/v1/token', '?grant_type=id_token'], ['POST', '/auth/v1/admin/users', ''], ['DELETE', '/auth/v1/admin/users/x', '']])
  ok(`auth ${m} ${p}${q} denied`, f(m, p, q).action === 'deny')
ok('storage upload denied', f('POST', '/storage/v1/object/logos/x.png').action === 'deny')
ok('storage GET allowed', f('GET', '/storage/v1/object/public/logos/x.png').action === 'allow')
ok('functions denied', f('POST', '/functions/v1/anything').action === 'deny')
ok('realtime denied', f('GET', '/realtime/v1/websocket').action === 'deny')
ok('graphql denied', f('POST', '/graphql/v1').action === 'deny')

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
