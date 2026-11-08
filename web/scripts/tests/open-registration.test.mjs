// Unit tests for web/src/lib/billing/openRegistration.ts (no RLS fallback) with a fake Supabase client.
import assert from 'node:assert/strict'
const { openRegistration, NO_CHARGE_RPC_NOT_DEPLOYED } = await import('@/lib/billing/openRegistration.ts')

function fakeClient(rpcResult) {
  const log = { rpc: [], from: [] }
  return { log, client: {
    rpc: async (name, args) => { log.rpc.push({ name, args }); return rpcResult(name) },
    from: (t) => { log.from.push(t); throw new Error('openRegistration must not touch tables directly') },
  } }
}
const results = []
async function t(name, fn) { try { await fn(); results.push(true); console.log('PASS', name) } catch (e) { results.push(false); console.log('FAIL', name, '-', e.message) } }

await t('calls only kb_open_registration_no_charge; never billing RPC; no table access', async () => {
  const { client, log } = fakeClient(() => ({ data: { ok: true, charged_by: 'none_billing_paused' }, error: null }))
  const r = await openRegistration(client, 's1')
  assert.equal(r.via, 'no_charge_rpc')
  assert.deepEqual(log.rpc, [{ name: 'kb_open_registration_no_charge', args: { p_session_id: 's1' } }])
  assert.equal(log.from.length, 0)
})
await t('RPC not deployed (PGRST202) → NO_CHARGE_RPC_NOT_DEPLOYED, no fallback write', async () => {
  const { client, log } = fakeClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }))
  await assert.rejects(() => openRegistration(client, 's1'), (e) => e.message === NO_CHARGE_RPC_NOT_DEPLOYED)
  assert.equal(log.from.length, 0)
})
await t('RPC not deployed (42883) → NO_CHARGE_RPC_NOT_DEPLOYED', async () => {
  const { client } = fakeClient(() => ({ data: null, error: { code: '42883', message: 'function does not exist' } }))
  await assert.rejects(() => openRegistration(client, 's1'), (e) => e.message === NO_CHARGE_RPC_NOT_DEPLOYED)
})
for (const m of ['NO_PERMISSION', 'INVALID_SESSION_STATUS', 'SESSION_NOT_FOUND', 'UNAUTHENTICATED']) {
  await t(`DB error ${m} is surfaced unchanged`, async () => {
    const { client, log } = fakeClient(() => ({ data: null, error: { code: 'P0001', message: m } }))
    await assert.rejects(() => openRegistration(client, 's1'), (e) => e.message === m)
    assert.equal(log.from.length, 0)
  })
}
await t('already_open is success', async () => {
  const { client } = fakeClient(() => ({ data: { ok: true, charged_by: 'already_open' }, error: null }))
  assert.equal((await openRegistration(client, 's1')).via, 'no_charge_rpc')
})
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0)
