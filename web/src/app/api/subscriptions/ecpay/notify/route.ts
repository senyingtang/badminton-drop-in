import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { processEcpayPaymentNotify } from '@/lib/payments/ecpayPaymentNotify'

export const runtime = 'nodejs'

function text(status: number, body: string) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** Same handler as /api/payments/ecpay/notify when subscription_notify_url points here. */
export async function POST(req: Request) {
  const admin = createServiceRoleClient()
  if (!admin) return text(500, 'SERVICE_ROLE_NOT_CONFIGURED')

  const payloadText = await req.text().catch(() => '')
  const result = await processEcpayPaymentNotify(admin, payloadText)
  return text(result.status, result.body)
}
