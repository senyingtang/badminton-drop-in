import type { SupabaseClient } from '@supabase/supabase-js'
import { insertPublicSignupErrorLog } from '@/lib/publicSignupErrorLog'
import { getLineMessagingAccessToken } from '@/lib/lineMessagingPush'

/**
 * 報名 / 候補轉正推播（LINE Messaging API push），每次結果寫入 public_signup_error_logs（flow = line_notify）：
 *   LINE_PUSH_ACCEPTED        LINE 回 200（或 409 = 同一 retry key 已送出過）
 *   LINE_PUSH_FAILED          LINE 回非 2xx（含 HTTP status、x-line-request-id、LINE 錯誤訊息）
 *   LINE_PUSH_EXCEPTION       連線失敗 / 逾時
 *   LINE_NO_MESSAGING_TOKEN   platform_line_integration 沒有 Messaging access token
 * 紀錄不含 access token、LINE User ID 或訊息內容。
 */
export type LineNotifyKind = 'signup' | 'waitlist_promotion'

export type LineNotifyResult =
  | { ok: true; requestId: string | null; duplicate: boolean }
  | { ok: false; code: string; status: number; requestId: string | null }

export async function pushLineNotify(
  admin: SupabaseClient,
  input: {
    kind: LineNotifyKind
    to: string
    text: string
    sessionParticipantId: string
    sessionId?: string | null
    actorUserId?: string | null
    /** UUID；LINE 以 X-Line-Retry-Key 去重（24 小時內同 key 不重送） */
    retryKey?: string | null
  },
): Promise<LineNotifyResult> {
  const log = async (code: string, message: string, detail: Record<string, unknown>) => {
    await insertPublicSignupErrorLog(admin, {
      session_id: input.sessionId ?? null,
      user_id: input.actorUserId ?? null,
      flow: 'line_notify',
      error_code: code,
      error_message: message.slice(0, 300),
      error_detail: { kind: input.kind, ...detail },
      payload_snapshot: { session_participant_id: input.sessionParticipantId },
    }).catch(() => {})
  }

  const token = await getLineMessagingAccessToken(admin)
  if (!token) {
    await log('LINE_NO_MESSAGING_TOKEN', 'messaging access token missing', {})
    return { ok: false, code: 'LINE_NO_MESSAGING_TOKEN', status: 503, requestId: null }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  if (input.retryKey) headers['X-Line-Retry-Key'] = input.retryKey

  let res: Response
  try {
    res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: input.to, messages: [{ type: 'text', text: input.text }] }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error'
    await log('LINE_PUSH_EXCEPTION', `push request failed: ${name}`, {})
    return { ok: false, code: 'LINE_PUSH_EXCEPTION', status: 0, requestId: null }
  }

  const requestId = res.headers.get('x-line-request-id')
  // 409 + 同一 retry key：先前已被 LINE 接受，不重送
  const duplicate = res.status === 409 && Boolean(res.headers.get('x-line-accepted-request-id'))
  if (res.ok || duplicate) {
    await log('LINE_PUSH_ACCEPTED', `status=${res.status}`, {
      status: res.status,
      line_request_id: requestId,
      accepted_request_id: res.headers.get('x-line-accepted-request-id'),
    })
    return { ok: true, requestId, duplicate }
  }

  // LINE 錯誤內容只有 message / details（property 名稱），不含收件者 ID
  let lineMessage = ''
  try {
    const j = (await res.json()) as { message?: unknown; details?: Array<{ message?: unknown; property?: unknown }> }
    lineMessage = [
      typeof j?.message === 'string' ? j.message : '',
      ...(Array.isArray(j?.details) ? j.details.map((d) => `${String(d?.property ?? '')}: ${String(d?.message ?? '')}`) : []),
    ]
      .filter(Boolean)
      .join(' | ')
  } catch {
    lineMessage = ''
  }
  console.error('LINE push failed', input.kind, res.status, requestId)
  await log('LINE_PUSH_FAILED', `status=${res.status} ${lineMessage}`.trim(), {
    status: res.status,
    line_request_id: requestId,
    line_message: lineMessage.slice(0, 300),
  })
  return { ok: false, code: 'LINE_PUSH_FAILED', status: res.status, requestId }
}
