// ECPay verification + notify processor tests (no network, no database).
// Run: npm run test:security
import assert from 'node:assert/strict'
const mac = await import('@/lib/payments/ecpay/checkMacValue.ts')
const ver = await import('@/lib/payments/ecpay/verifyNotify.ts')
const proc = await import('@/lib/payments/ecpayPaymentNotify.ts')

// ECPay public test credentials (stage merchant 3002607), from developers.ecpay.com.tw/?p=2902
const SANDBOX = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs', mode: 'sandbox' }
const PROD = { ...SANDBOX, mode: 'production' }

const results = []
async function t(name, fn) { try { await fn(); results.push(true); console.log('PASS', name) } catch (e) { results.push(false); console.log('FAIL', name, '-', e.message) } }

await t('CheckMacValue matches ECPay official worked example', async () => {
  const params = {
    TradeDesc: '促銷方案', PaymentType: 'aio', MerchantTradeDate: '2023/03/12 15:30:23', MerchantTradeNo: 'ecpay20230312153023',
    MerchantID: '3002607', ReturnURL: 'https://www.ecpay.com.tw/receive.php', ItemName: 'Apple iphone 15', TotalAmount: '30000',
    ChoosePayment: 'ALL', EncryptType: '1',
  }
  assert.equal(await mac.computeCheckMacValue(params, SANDBOX.hashKey, SANDBOX.hashIV),
    '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840')
})
await t('URL encoding matches ECPay .NET table (- _ . ! * ( ) literal; space → +; ~ \' encoded)', async () => {
  assert.equal(mac.ecpayUrlEncode("a-b_c.d!e*f(g)h i~j'k"), 'a-b_c.d!e*f(g)h+i%7Ej%27k')
})

async function signedNotify(overrides = {}, cfg = SANDBOX) {
  const p = {
    MerchantID: cfg.merchantId, MerchantTradeNo: 'T0123456789abcdef', StoreID: '', RtnCode: '1', RtnMsg: '交易成功',
    TradeNo: '2311081234567890', TradeAmt: '500', PaymentDate: '2026/11/08 12:00:00', PaymentType: 'Credit_CreditCard',
    PaymentTypeChargeFee: '10', TradeDate: '2026/11/08 11:59:00', SimulatePaid: '0', CustomField1: '', ...overrides,
  }
  p.CheckMacValue = await mac.computeCheckMacValue(p, cfg.hashKey, cfg.hashIV)
  return p
}
const body = (p) => new URLSearchParams(p).toString()

await t('valid signed notify verifies; amount converted to cents', async () => {
  const r = await ver.verifyEcpayNotify(body(await signedNotify()), SANDBOX)
  assert.equal(r.ok, true); assert.equal(r.amountCents, 50000); assert.equal(r.merchantTradeNo, 'T0123456789abcdef')
})
await t('forged: TradeAmt changed after signing → BAD_CHECK_MAC_VALUE', async () => {
  const p = await signedNotify(); p.TradeAmt = '50000'
  assert.deepEqual(await ver.verifyEcpayNotify(body(p), SANDBOX), { ok: false, reason: 'BAD_CHECK_MAC_VALUE' })
})
await t('forged: RtnCode flipped to 1 after signing → BAD_CHECK_MAC_VALUE', async () => {
  const p = await signedNotify({ RtnCode: '10100058' }); p.RtnCode = '1'
  assert.equal((await ver.verifyEcpayNotify(body(p), SANDBOX)).reason, 'BAD_CHECK_MAC_VALUE')
})
await t('forged: no CheckMacValue → rejected', async () => {
  const p = await signedNotify(); delete p.CheckMacValue
  assert.equal((await ver.verifyEcpayNotify(body(p), SANDBOX)).reason, 'BAD_CHECK_MAC_VALUE')
})
await t('forged: signed with a different HashKey → rejected', async () => {
  const p = await signedNotify({}, { ...SANDBOX, hashKey: 'attackerKey00000' })
  assert.equal((await ver.verifyEcpayNotify(body(p), SANDBOX)).reason, 'BAD_CHECK_MAC_VALUE')
})
await t('lower-case CheckMacValue is accepted (case-insensitive hex)', async () => {
  const p = await signedNotify(); p.CheckMacValue = p.CheckMacValue.toLowerCase()
  assert.equal((await ver.verifyEcpayNotify(body(p), SANDBOX)).ok, true)
})
await t('another merchant (valid MAC, wrong MerchantID) → MERCHANT_MISMATCH', async () => {
  const p = await signedNotify({ MerchantID: '2000132' })
  assert.equal((await ver.verifyEcpayNotify(body(p), SANDBOX)).reason, 'MERCHANT_MISMATCH')
})
await t('SimulatePaid=1 rejected in production', async () => {
  const p = await signedNotify({ SimulatePaid: '1' }, PROD)
  assert.equal((await ver.verifyEcpayNotify(body(p), PROD)).reason, 'SIMULATED_PAYMENT_IN_PRODUCTION')
})
await t('SimulatePaid=1 allowed in sandbox (flagged simulated)', async () => {
  const r = await ver.verifyEcpayNotify(body(await signedNotify({ SimulatePaid: '1' })), SANDBOX)
  assert.equal(r.ok, true); assert.equal(r.simulated, true)
})
for (const amt of ['', '0', '-5', '1.5', 'abc']) {
  await t(`invalid TradeAmt "${amt}" → BAD_TRADE_AMT`, async () => {
    assert.equal((await ver.verifyEcpayNotify(body(await signedNotify({ TradeAmt: amt })), SANDBOX)).reason, 'BAD_TRADE_AMT')
  })
}
await t('invalid MerchantTradeNo → BAD_MERCHANT_TRADE_NO', async () => {
  assert.equal((await ver.verifyEcpayNotify(body(await signedNotify({ MerchantTradeNo: "x' or 1=1" })), SANDBOX)).reason, 'BAD_MERCHANT_TRADE_NO')
})
await t('config from env: requires all three secrets; never NEXT_PUBLIC', async () => {
  assert.equal(ver.getEcpayConfigFromEnv({ ECPAY_MERCHANT_ID: '1', ECPAY_HASH_KEY: 'k' }), null)
  assert.equal(ver.getEcpayConfigFromEnv({ NEXT_PUBLIC_ECPAY_HASH_KEY: 'k', ECPAY_MERCHANT_ID: '1', ECPAY_HASH_IV: 'i' }), null)
  assert.deepEqual(ver.getEcpayConfigFromEnv({ ECPAY_MERCHANT_ID: '1', ECPAY_HASH_KEY: 'k', ECPAY_HASH_IV: 'i' }), { merchantId: '1', hashKey: 'k', hashIV: 'i', mode: 'sandbox' })
})

// ---- processor with a fake service-role client ----
function fakeAdmin(rpcResult) {
  const log = { rpc: [], from: [], updates: [] }
  const q = (table) => {
    const b = { _t: table, update(v) { log.updates.push({ table, v }); return b }, eq() { return b }, select() { return b }, limit() { return b },
      maybeSingle: async () => ({ data: { id: 'txn-1' }, error: null }), then(res) { res({ data: null, error: null }) } }
    return b
  }
  return { log, admin: { rpc: async (n, a) => { log.rpc.push({ n, a }); return rpcResult(n, a) }, from: (t) => { log.from.push(t); return q(t) } } }
}
const commissions = []
const deps = { createCommission: async (_a, ev) => { commissions.push(ev) } }

await t('processor: payments not configured → 503, no DB access', async () => {
  const { admin, log } = fakeAdmin(() => ({}))
  const r = await proc.processEcpayPaymentNotify(admin, body(await signedNotify()), null, deps)
  assert.equal(r.status, 503); assert.equal(log.rpc.length + log.from.length, 0)
})
await t('processor: forged notify → 400, NO database access, NO commission', async () => {
  const { admin, log } = fakeAdmin(() => ({}))
  const p = await signedNotify(); p.TradeAmt = '99999'
  commissions.length = 0
  const r = await proc.processEcpayPaymentNotify(admin, body(p), SANDBOX, deps)
  assert.equal(r.body, '0|BAD_CHECK_MAC_VALUE'); assert.equal(log.rpc.length + log.from.length, 0); assert.equal(commissions.length, 0)
})
await t('processor: RtnCode≠1 → only marks pending order failed, never credits', async () => {
  const { admin, log } = fakeAdmin(() => ({}))
  const r = await proc.processEcpayPaymentNotify(admin, body(await signedNotify({ RtnCode: '10100058' })), SANDBOX, deps)
  assert.equal(r.body, '1|OK'); assert.equal(log.rpc.length, 0)
  assert.deepEqual(log.updates.map((u) => [u.table, u.v.status]), [['kb_payment_orders', 'failed']])
})
await t('processor: verified payment → single atomic DB call with verified amount; commission once', async () => {
  commissions.length = 0
  const { admin, log } = fakeAdmin(() => ({ data: { result: 'paid', order_id: 'o1', purpose: 'wallet_topup', user_id: 'u1', amount_cents: 50000, wallet_transaction_id: 'w1', paid_at: 'now' }, error: null }))
  const r = await proc.processEcpayPaymentNotify(admin, body(await signedNotify()), SANDBOX, deps)
  assert.equal(r.body, '1|OK')
  assert.deepEqual(log.rpc.map((c) => [c.n, c.a.p_merchant_trade_no, c.a.p_amount_cents]), [['kb_payment_order_mark_paid', 'T0123456789abcdef', 50000]])
  assert.equal(log.updates.length, 0, 'no direct wallet/order writes from the app')
  assert.equal(commissions.length, 1); assert.equal(commissions[0].sourceId, 'w1')
})
await t('processor: replay (already_paid) → 1|OK, no credit path, commission retried idempotently', async () => {
  commissions.length = 0
  const { admin, log } = fakeAdmin(() => ({ data: { result: 'already_paid', order_id: 'o1', purpose: 'wallet_topup', user_id: 'u1', amount_cents: 50000 }, error: null }))
  const r = await proc.processEcpayPaymentNotify(admin, body(await signedNotify()), SANDBOX, deps)
  assert.equal(r.body, '1|OK'); assert.equal(log.updates.length, 0); assert.equal(commissions.length, 1)
})
for (const [res, code] of [['not_found', '0|ORDER_NOT_FOUND'], ['amount_mismatch', '0|AMOUNT_MISMATCH'], ['invalid_status', '0|INVALID_ORDER_STATUS']]) {
  await t(`processor: DB says ${res} → ${code}, no commission`, async () => {
    commissions.length = 0
    const { admin } = fakeAdmin(() => ({ data: { result: res, order_id: 'o', status: 'canceled' }, error: null }))
    const r = await proc.processEcpayPaymentNotify(admin, body(await signedNotify()), SANDBOX, deps)
    assert.equal(r.body, code); assert.equal(commissions.length, 0)
  })
}
await t('processor: DB function missing / error → 500, no commission', async () => {
  commissions.length = 0
  const { admin } = fakeAdmin(() => ({ data: null, error: { code: 'PGRST202', message: 'missing' } }))
  const r = await proc.processEcpayPaymentNotify(admin, body(await signedNotify()), SANDBOX, deps)
  assert.equal(r.status, 500); assert.equal(commissions.length, 0)
})

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
