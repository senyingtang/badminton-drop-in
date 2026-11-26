// LIFF first-open parameters arrive inside liff.state (src/lib/auth/liffState.ts).
// Production evidence: /liff/line-login logged LIFF_RETURN_TO_LOST and fell back to /member-dashboard/dropins.
import { readLiffParam } from '../../src/lib/auth/liffState.ts'
import { isSafeInternalReturnPath } from '../../src/lib/safeInternalReturnPath.ts'

const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} liff-state: ${name}${detail && !pass ? ' — ' + detail : ''}`) }
const sp = (url) => new URL(url, 'https://example.workers.dev').searchParams

// exactly what liff.line.me sends to the endpoint (captured from production: liff.state=%3FreturnTo%3D%252Fs%252FTEST)
const first = sp('/liff/line-login?liff.state=%3FreturnTo%3D%252Fs%252FTEST')
ok('returnTo read from liff.state on first open', readLiffParam(first, 'returnTo') === '/s/TEST', readLiffParam(first, 'returnTo'))
ok('returnTo from liff.state is a safe internal path', isSafeInternalReturnPath(readLiffParam(first, 'returnTo')))
const withRef = sp('/liff/line-login?liff.state=' + encodeURIComponent('?returnTo=' + encodeURIComponent('/s/AB12') + '&ref=XYZ23456'))
ok('ref read from liff.state', readLiffParam(withRef, 'ref') === 'XYZ23456')
const pathState = sp('/liff/line-login?liff.state=' + encodeURIComponent('/sub/path?returnTo=' + encodeURIComponent('/member-dashboard')))
ok('liff.state with a path prefix', readLiffParam(pathState, 'returnTo') === '/member-dashboard')
ok('direct parameter wins (after secondary redirect)', readLiffParam(sp('/liff/line-login?returnTo=%2Fs%2FDIRECT&liff.state=%3FreturnTo%3D%252Fs%252FOTHER'), 'returnTo') === '/s/DIRECT')
ok('no parameter -> null (caller falls back)', readLiffParam(sp('/liff/line-login'), 'returnTo') === null)
ok('liff.state without query -> null', readLiffParam(sp('/liff/line-login?liff.state=%2Fonly-path'), 'returnTo') === null)
ok('blank values -> null', readLiffParam(sp('/liff/line-login?returnTo=%20&liff.state=%3FreturnTo%3D'), 'returnTo') === null)
// open-redirect values are still returned raw; the page rejects them with isSafeInternalReturnPath
for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
  const v = readLiffParam(sp('/liff/line-login?liff.state=' + encodeURIComponent('?returnTo=' + encodeURIComponent(bad))), 'returnTo')
  ok(`unsafe returnTo from liff.state rejected by the page check (${bad})`, !isSafeInternalReturnPath(v), v)
}

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
