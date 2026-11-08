import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { processEcpayPaymentNotify } from './ecpayPaymentNotify'
import { getEcpayConfigFromEnv } from './ecpay/verifyNotify'
import { ONLINE_PAYMENTS_ENABLED, ecpayNotifyDisabledResponse } from './paymentGate'

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * /api/payments/ecpay/notify 與 /api/subscriptions/ecpay/notify 共用。
 * ONLINE_PAYMENTS_ENABLED=false 時：不讀取 body、不存取資料庫，一律 503。
 */
export async function handleEcpayNotify(req: Request): Promise<Response> {
  if (!ONLINE_PAYMENTS_ENABLED) return ecpayNotifyDisabledResponse()

  const admin = createServiceRoleClient()
  if (!admin) return text(500, '0|SERVICE_ROLE_NOT_CONFIGURED')

  const payloadText = await req.text().catch(() => '')
  const result = await processEcpayPaymentNotify(admin, payloadText, getEcpayConfigFromEnv())
  return text(result.status, result.body)
}
