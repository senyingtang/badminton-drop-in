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

function normalizeUserText(input: string): string {
  // - trim 前後空白
  // - 全形空白轉半形
  // - 合併多個空白
  const s = String(input || '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s
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
    const messageTextRaw = typeof ev?.message?.text === 'string' ? ev.message.text : ''
    const messageText = normalizeUserText(messageTextRaw)
    const lineUserId = typeof ev?.source?.userId === 'string' ? ev.source.userId : ''

    if (!replyToken || type !== 'message' || !messageText) continue

    // Keyword-only webhook:
    // - Only reply to: 綁定 / 我要綁定 / 綁定 ABC123 / 解除綁定
    // - Everything else: return 200 without replying (LINE OA manager handles manual/auto responses)

    // 解除綁定
    if (messageText === '解除綁定') {
      if (!lineUserId) {
        // 不回覆非綁定必要資訊的錯誤；但解除綁定屬於關鍵字，所以仍回覆格式化訊息
        await replyText(replyToken, '目前尚未綁定 LINE@ 通知。', accessToken)
        continue
      }

      const { data: player } = await admin.from('players').select('id').eq('line_oa_user_id', lineUserId).maybeSingle()
      const { data: profile } = await admin.from('app_user_profiles').select('id').eq('line_oa_user_id', lineUserId).maybeSingle()

      if (!player && !profile) {
        await replyText(replyToken, '目前尚未綁定 LINE@ 通知。', accessToken)
        continue
      }

      if (player?.id) await admin.from('players').update({ line_oa_user_id: null }).eq('id', player.id)
      if (profile?.id) await admin.from('app_user_profiles').update({ line_oa_user_id: null }).eq('id', profile.id)

      await replyText(replyToken, 'LINE@ 通知已解除綁定。', accessToken)
      continue
    }

    // 只輸入「綁定」或「我要綁定」
    if (messageText === '綁定' || messageText === '我要綁定') {
      await replyText(
        replyToken,
        ['請輸入完整綁定指令：', '', '綁定 ABC123', '', 'ABC123 請替換為您在會員中心產生的綁定碼。'].join('\n'),
        accessToken
      )
      continue
    }

    // 綁定 ABC123
    const m = messageText.match(/^綁定\s+([A-Za-z0-9]{6})$/)
    if (!m) {
      // non-binding keyword => no reply
      continue
    }

    const code = m[1].toUpperCase()
    const nowIso = new Date().toISOString()

    const { data: bc } = await admin
      .from('line_oa_binding_codes')
      .select('id, code, player_id, user_id, expires_at, used_at, status')
      .eq('code', code)
      .maybeSingle()

    if (!bc) {
      await replyText(
        replyToken,
        ['找不到此綁定碼，請確認是否輸入正確。', '', '正確格式：', '綁定 ABC123'].join('\n'),
        accessToken
      )
      continue
    }

    const expiresAt = String((bc as any).expires_at || '')
    const usedAt = (bc as any).used_at as string | null | undefined
    const status = String((bc as any).status || '')

    if (usedAt || status === 'used') {
      await replyText(
        replyToken,
        ['此綁定碼已使用。', '', '若需要重新綁定，請回會員中心重新產生新的綁定碼。'].join('\n'),
        accessToken
      )
      continue
    }

    if (!expiresAt || Date.parse(expiresAt) < Date.now() || status === 'expired') {
      await replyText(
        replyToken,
        ['此綁定碼已逾期，請回會員中心重新產生。', '', '綁定碼有效時間為 10 分鐘。'].join('\n'),
        accessToken
      )
      continue
    }

    if (!lineUserId) {
      await replyText(
        replyToken,
        ['找不到此綁定碼，請確認是否輸入正確。', '', '正確格式：', '綁定 ABC123'].join('\n'),
        accessToken
      )
      continue
    }

    // Update binding code record
    await admin
      .from('line_oa_binding_codes')
      .update({ status: 'used', used_at: nowIso, line_oa_user_id: lineUserId, used_line_oa_user_id: lineUserId })
      .eq('code', code)

    // Update players + optionally app_user_profiles
    const playerId = (bc as any).player_id as string | null | undefined
    if (playerId) {
      await admin.from('players').update({ line_oa_user_id: lineUserId }).eq('id', playerId)
    }

    const userId = (bc as any).user_id as string | null | undefined
    if (userId) {
      // Only update if column exists
      await admin.from('app_user_profiles').update({ line_oa_user_id: lineUserId } as any).eq('id', userId)
    }

    await replyText(
      replyToken,
      ['LINE@ 通知綁定成功 ✅', '', '之後名單異動、候補遞補、開打提醒，將會透過 LINE 通知您。'].join('\n'),
      accessToken
    )
  }

  return NextResponse.json({ ok: true })
}

