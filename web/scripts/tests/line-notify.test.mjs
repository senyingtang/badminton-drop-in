// LINE 報名推播（src/lib/lineNotifyPush.ts、src/lib/lineNotifyClient.ts）。全部 mock：不呼叫 LINE、不寫資料庫。
const { pushLineNotify } = await import('@/lib/lineNotifyPush.ts')
const { triggerLineNotify } = await import('@/lib/lineNotifyClient.ts')

const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} line-notify: ${name}${detail && !pass ? ' — ' + detail : ''}`) }

const TOKEN = 'tok_' + 'x'.repeat(40)
const TO = 'U' + 'a'.repeat(32)
function fakeAdmin(token = TOKEN) {
  const logs = []
  return {
    logs,
    from(table) {
      if (table === 'platform_line_integration') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: token ? { messaging_channel_access_token: token } : null }) }) }) }
      }
      if (table === 'public_signup_error_logs') return { insert: async (row) => { logs.push(row); return { error: null } } }
      throw new Error('unexpected table ' + table)
    },
  }
}
const realFetch = globalThis.fetch
let sent = []
function mockLine(status, headers = {}, body = {}) {
  sent = []
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }
}
const base = { kind: 'signup', to: TO, text: 'hello', sessionParticipantId: '11111111-2222-4333-8444-555555555555', sessionId: 's1', actorUserId: 'u1' }
const noSecrets = (logs) => !JSON.stringify(logs).includes(TOKEN) && !JSON.stringify(logs).includes(TO) && !JSON.stringify(logs).includes('hello')

// 1. accepted
let admin = fakeAdmin()
mockLine(200, { 'x-line-request-id': 'req-ok' })
let r = await pushLineNotify(admin, { ...base, retryKey: base.sessionParticipantId })
ok('200 -> ok with request id', r.ok && r.requestId === 'req-ok')
ok('push goes to Messaging API push endpoint', sent.length === 1 && sent[0].url === 'https://api.line.me/v2/bot/message/push')
ok('uses Messaging token from platform_line_integration', sent[0].init.headers.Authorization === 'Bearer ' + TOKEN)
ok('retry key = participant id (no duplicate pushes)', sent[0].init.headers['X-Line-Retry-Key'] === base.sessionParticipantId)
ok('accepted is logged as LINE_PUSH_ACCEPTED', admin.logs.length === 1 && admin.logs[0].error_code === 'LINE_PUSH_ACCEPTED' && admin.logs[0].flow === 'line_notify' && admin.logs[0].error_detail.line_request_id === 'req-ok')
ok('log has no token / LINE user id / message text', noSecrets(admin.logs))

// 2. duplicate via retry key
admin = fakeAdmin()
mockLine(409, { 'x-line-request-id': 'req-dup', 'x-line-accepted-request-id': 'req-first' }, { message: 'The retry key is already accepted' })
r = await pushLineNotify(admin, { ...base, retryKey: base.sessionParticipantId })
ok('409 with accepted id -> ok duplicate (not re-sent)', r.ok && r.duplicate === true)

// 3. LINE error
admin = fakeAdmin()
mockLine(400, { 'x-line-request-id': 'req-bad' }, { message: 'The request body has 1 error(s)', details: [{ message: 'Invalid to', property: 'to' }] })
r = await pushLineNotify(admin, base)
ok('400 -> LINE_PUSH_FAILED with status + request id', !r.ok && r.code === 'LINE_PUSH_FAILED' && r.status === 400 && r.requestId === 'req-bad')
ok('failure log carries status, request id and LINE message', admin.logs[0]?.error_code === 'LINE_PUSH_FAILED' && admin.logs[0].error_detail.status === 400 && /Invalid to/.test(admin.logs[0].error_message))
ok('failure log has no secrets', noSecrets(admin.logs))
ok('no retry key header when not given', !('X-Line-Retry-Key' in sent[0].init.headers))

// 4. no token
admin = fakeAdmin('')
mockLine(200)
r = await pushLineNotify(admin, base)
ok('missing token -> LINE_NO_MESSAGING_TOKEN, nothing sent', !r.ok && r.code === 'LINE_NO_MESSAGING_TOKEN' && sent.length === 0 && admin.logs[0]?.error_code === 'LINE_NO_MESSAGING_TOKEN')

// 5. network exception
admin = fakeAdmin()
globalThis.fetch = async () => { throw new TypeError('network down') }
r = await pushLineNotify(admin, base)
ok('network error -> LINE_PUSH_EXCEPTION logged', !r.ok && r.code === 'LINE_PUSH_EXCEPTION' && admin.logs[0]?.error_code === 'LINE_PUSH_EXCEPTION')

// 6. client trigger: keepalive + awaited before navigation
sent = []
let finished = false
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); await new Promise((res) => setTimeout(res, 30)); finished = true; return new Response('{}') }
await triggerLineNotify('/api/line/notify-signup', ['a', 'b', ''])
ok('client sends one request per participant (blank skipped)', sent.length === 2)
ok('client requests use keepalive', sent.every((s) => s.init.keepalive === true))
ok('client waits for the requests before returning (no reload race)', finished)
globalThis.fetch = async () => new Promise(() => {})
const t0 = Date.now()
await triggerLineNotify('/api/line/notify-signup', ['a'], 50)
ok('client wait is bounded by timeout', Date.now() - t0 < 1000)

globalThis.fetch = realFetch
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
