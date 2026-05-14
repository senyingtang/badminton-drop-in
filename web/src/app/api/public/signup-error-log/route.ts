import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { insertPublicSignupErrorLog } from '@/lib/publicSignupErrorLog'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

const MAX_JSON = 48_000

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status })
}

type Body = {
  share_signup_code?: unknown
  session_id?: unknown
  user_id?: unknown
  flow?: unknown
  error_code?: unknown
  error_message?: unknown
  error_detail?: unknown
  payload_snapshot?: unknown
}

export async function POST(req: Request) {
  const raw = await req.text()
  if (raw.length > MAX_JSON) return json(413, { ok: false, error: 'payload_too_large' })

  let body: Body
  try {
    body = JSON.parse(raw) as Body
  } catch {
    return json(400, { ok: false, error: 'invalid_json' })
  }

  const errorCode = typeof body.error_code === 'string' ? body.error_code.trim() : ''
  if (!errorCode || errorCode.length > 120) return json(400, { ok: false, error: 'error_code_required' })
  if (!/^[A-Za-z0-9_]+$/.test(errorCode)) return json(400, { ok: false, error: 'error_code_invalid' })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createServiceRoleClient()
  if (!admin) return json(503, { ok: false, error: 'service_role_not_configured' })

  const shareSignupCode =
    typeof body.share_signup_code === 'string' ? body.share_signup_code.trim().slice(0, 200) : null
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : null
  const flow = typeof body.flow === 'string' ? body.flow.trim().slice(0, 80) : null
  const errorMessage =
    typeof body.error_message === 'string' ? body.error_message.trim().slice(0, 2000) : null

  const errorDetail =
    body.error_detail && typeof body.error_detail === 'object' && !Array.isArray(body.error_detail)
      ? (body.error_detail as Record<string, unknown>)
      : {}
  const payloadSnapshot =
    body.payload_snapshot && typeof body.payload_snapshot === 'object' && !Array.isArray(body.payload_snapshot)
      ? (body.payload_snapshot as Record<string, unknown>)
      : {}

  const ua = typeof req.headers.get('user-agent') === 'string' ? req.headers.get('user-agent')!.slice(0, 512) : null

  const loggedUserId = user?.id ?? null

  const ins = await insertPublicSignupErrorLog(admin, {
    share_signup_code: shareSignupCode,
    session_id: sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : null,
    user_id: loggedUserId,
    flow,
    error_code: errorCode.toUpperCase(),
    error_message: errorMessage,
    error_detail: errorDetail,
    payload_snapshot: payloadSnapshot,
    user_agent: ua,
  })

  if (!ins.ok) {
    if (ins.tableMissing) {
      console.warn('public_signup_error_logs table missing; run docs/086_line_contact_and_signup_error_logs.sql')
      return json(503, {
        ok: false,
        error: 'table_not_configured',
        errorCode: 'PUBLIC_SIGNUP_ERROR_LOGS_TABLE_MISSING',
      })
    }
    console.warn('public_signup_error_logs insert failed:', ins.message)
    return json(500, { ok: false, error: 'log_insert_failed', errorCode: 'LOG_INSERT_FAILED' })
  }

  return json(200, { ok: true })
}
