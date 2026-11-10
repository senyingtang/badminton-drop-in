import fs from 'node:fs'
import { SB, PW } from './lib.mjs'
export const ANON = fs.readFileSync('D:/project/secrets/staging.env', 'utf8').match(/ANON_KEY=(.*)/)[1].trim()
export async function asUser(email) {
  const t = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json()).access_token
  return (path, init = {}) => fetch(`${SB}${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers || {}) } }).then(async (r) => ({ status: r.status, j: await r.text() }))
}
