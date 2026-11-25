// service_role key format check (src/lib/supabase/serviceRoleKey.ts). Synthetic keys only.
import { checkServiceRoleKeyFormat as check } from '../../src/lib/supabase/serviceRoleKey.ts'

const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} service-role-key: ${name}${detail && !pass ? ' — ' + detail : ''}`) }
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.c2lnbmF0dXJlX3BhcnRfZmFrZQ`
const sr = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role', iat: 1, exp: 2 })

ok('bare service_role JWT accepted', check(sr).ok === true)
ok('surrounding whitespace / newline tolerated', check(`  ${sr}\r\n`).ok === true)
ok('sb_secret_ key accepted', check('sb_secret_' + 'a'.repeat(32)).ok === true)
const prefixed = check(`Service_Role_Key=${sr}`)
ok('"Service_Role_Key=<jwt>" rejected (the production incident)', prefixed.ok === false && /NAME=value/.test(prefixed.reason), JSON.stringify(prefixed))
ok('"SUPABASE_SERVICE_ROLE_KEY=<jwt>" rejected', check(`SUPABASE_SERVICE_ROLE_KEY=${sr}`).ok === false)
ok('quoted JWT rejected', check(`"${sr}"`).ok === false)
ok('anon JWT rejected (wrong role)', check(jwt({ ref: 'x', role: 'anon' })).ok === false)
ok('authenticated JWT rejected', check(jwt({ role: 'authenticated' })).ok === false)
ok('two-part token rejected', check(sr.split('.').slice(0, 2).join('.')).ok === false)
ok('empty rejected', check('').ok === false && check(undefined).ok === false)
ok('garbage payload rejected', check('eyJhbGciOiJIUzI1NiJ9.eyJ!!!.sig').ok === false)
ok('reason never contains the key', !JSON.stringify(prefixed).includes(sr.split('.')[1]))

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
