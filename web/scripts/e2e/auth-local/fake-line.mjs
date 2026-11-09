// TEST-ONLY preload: replaces LINE's token endpoint with a local fake. Never used outside the local isolated test.
const real = globalThis.fetch
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('https://api.line.me/oauth2/v2.1/token')) {
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : init?.body?.toString())
    let c
    try { c = JSON.parse(Buffer.from(params.get('code') || '', 'base64url').toString()) } catch { c = null }
    if (!c) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } })
    const now = Math.floor(Date.now() / 1000)
    const payload = { iss: 'https://access.line.me', aud: c.aud ?? params.get('client_id'), exp: now + 3600, iat: now, nonce: c.nonce, sub: c.sub, name: c.name, ...(c.email ? { email: c.email } : {}) }
    return new Response(JSON.stringify({ access_token: 'fake', id_token: `${b64u({ alg: 'HS256' })}.${b64u(payload)}.sig`, token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return real(input, init)
}
