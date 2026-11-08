import { handleEcpayNotify } from '@/lib/payments/ecpayNotifyRoute'

export const runtime = 'nodejs'

/** ECPay 訂閱 notify，與 /api/payments/ecpay/notify 共用同一套驗證與入帳流程。 */
export async function POST(req: Request) {
  return handleEcpayNotify(req)
}
