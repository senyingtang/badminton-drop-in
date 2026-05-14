import type { SupabaseClient } from '@supabase/supabase-js'

/** 讀取平台 Messaging API channel access token（`platform_line_integration` id=1） */
export async function getLineMessagingAccessToken(admin: SupabaseClient): Promise<string | null> {
  const { data: cfg } = await admin
    .from('platform_line_integration')
    .select('messaging_channel_access_token')
    .eq('id', 1)
    .maybeSingle()
  const t =
    cfg && typeof (cfg as { messaging_channel_access_token?: unknown }).messaging_channel_access_token === 'string'
      ? String((cfg as { messaging_channel_access_token: string }).messaging_channel_access_token).trim()
      : ''
  return t || null
}

export type LinePushResult =
  | { ok: true }
  | { ok: false; status: number; detail: string; code: 'LINE_API_ERROR' | 'NO_MESSAGING_TOKEN' }

/** 以 LINE Messaging API `push` 發送一則文字訊息 */
export async function lineMessagingPushText(
  admin: SupabaseClient,
  to: string,
  text: string,
): Promise<LinePushResult> {
  const token = await getLineMessagingAccessToken(admin)
  if (!token) {
    return { ok: false, status: 503, detail: 'Messaging channel access token 未設定', code: 'NO_MESSAGING_TOKEN' }
  }
  const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  })
  if (!lineRes.ok) {
    const errText = await lineRes.text()
    return { ok: false, status: lineRes.status, detail: errText.slice(0, 800), code: 'LINE_API_ERROR' }
  }
  return { ok: true }
}
