import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'

// LINE Console 的 Verify / 人工測試用（GET 也回 200）
export async function GET() {
  return NextResponse.json({ ok: true })
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return nodeTimingSafeEqual(ab, bb)
}

async function verifyLineSignature(bodyText: string, signature: string, channelSecret: string): Promise<boolean> {
  const mac = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', mac, new TextEncoder().encode(bodyText))
  const expected = Buffer.from(sigBuf).toString('base64')
  return timingSafeEqual(expected, signature)
}

async function replyText(replyToken: string, text: string, accessToken: string) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  }).catch(() => {})
}

export async function POST(req: Request) {
  const signature = req.headers.get('x-line-signature') || ''
  const bodyText = await req.text()

  const admin = createServiceRoleClient()
  if (!admin) return NextResponse.json({ ok: false, error: 'service_role_not_configured' }, { status: 503 })

  const { data: cfg } = await admin
    .from('platform_line_integration')
    .select('messaging_channel_secret, messaging_channel_access_token')
    .eq('id', 1)
    .maybeSingle()

  const channelSecret = typeof (cfg as any)?.messaging_channel_secret === 'string' ? (cfg as any).messaging_channel_secret.trim() : ''
  const accessToken = typeof (cfg as any)?.messaging_channel_access_token === 'string' ? (cfg as any).messaging_channel_access_token.trim() : ''
  if (!channelSecret || !accessToken) {
    return NextResponse.json({ ok: false, error: 'missing_messaging_config' }, { status: 503 })
  }

  if (!signature || !(await verifyLineSignature(bodyText, signature, channelSecret))) {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 })
  }

  let payload: any = null
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const events: any[] = Array.isArray(payload?.events) ? payload.events : []
  for (const ev of events) {
    const replyToken = typeof ev?.replyToken === 'string' ? ev.replyToken : ''
    const type = ev?.type
    const messageText = typeof ev?.message?.text === 'string' ? ev.message.text.trim() : ''
    const lineUserId = typeof ev?.source?.userId === 'string' ? ev.source.userId : ''

    if (!replyToken || type !== 'message' || !messageText) continue

    const m = messageText.match(/^綁定\s+([A-Z2-9]{6})$/i)
    if (!m) {
      await replyText(replyToken, '若要綁定通知，請輸入：綁定 代碼（例如：綁定 ABCD12）', accessToken)
      continue
    }

    const code = m[1].toUpperCase()
    const nowIso = new Date().toISOString()

    const { data: bc } = await admin
      .from('line_oa_binding_codes')
      .select('code, player_id, expires_at, used_at')
      .eq('code', code)
      .maybeSingle()

    if (!bc) {
      await replyText(replyToken, '綁定失敗：代碼不存在或已失效。請回到網站重新產生綁定代碼。', accessToken)
      continue
    }

    const expiresAt = String((bc as any).expires_at || '')
    const usedAt = (bc as any).used_at as string | null | undefined
    if (usedAt) {
      await replyText(replyToken, '此綁定代碼已使用過。若需重新綁定，請回到網站重新產生代碼。', accessToken)
      continue
    }
    if (!expiresAt || Date.parse(expiresAt) < Date.now()) {
      await replyText(replyToken, '綁定失敗：代碼已過期。請回到網站重新產生綁定代碼。', accessToken)
      continue
    }
    if (!lineUserId) {
      await replyText(replyToken, '綁定失敗：無法取得您的 LINE UID（請確認已加官方帳號為好友）。', accessToken)
      continue
    }

    const playerId = (bc as any).player_id as string

    // 寫入 players.line_oa_user_id（若已寫入就視為成功）
    const { data: p } = await admin
      .from('players')
      .select('id, line_oa_user_id')
      .eq('id', playerId)
      .maybeSingle()

    if (!p) {
      await replyText(replyToken, '綁定失敗：找不到對應使用者。請回到網站重新產生綁定代碼。', accessToken)
      continue
    }

    const existing = (p as any).line_oa_user_id as string | null | undefined
    if (!existing) {
      const up = await admin.from('players').update({ line_oa_user_id: lineUserId }).eq('id', playerId)
      if (up.error) {
        await replyText(replyToken, '綁定失敗：系統寫入失敗，請稍後再試。', accessToken)
        continue
      }
    }

    // 標記綁定碼已使用
    await admin
      .from('line_oa_binding_codes')
      .update({ used_at: nowIso, used_line_oa_user_id: lineUserId })
      .eq('code', code)

    await replyText(replyToken, '綁定成功！之後名單異動會透過 LINE 通知您。', accessToken)
  }

  return NextResponse.json({ ok: true })
}

