import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { classifyAuthError, profileLoginBlock, validateEmail } from '@/lib/auth/authPolicy'

export const runtime = 'nodejs'

/**
 * Email / 密碼登入（伺服端寫入 HttpOnly session cookie）。
 * - 回應只帶錯誤代碼（invalid_credentials / email_not_confirmed / rate_limited / auth_unavailable /
 *   account_suspended / account_deleted），不回 Supabase 原文、不回 token。
 * - 停權 / 已刪除的帳號：登入成功後立即登出並拒絕。
 * - 不記錄密碼或 token。
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string } | null = null
  try {
    body = (await req.json()) as { email?: string; password?: string }
  } catch {
    body = null
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password || validateEmail(email)) {
    return NextResponse.json({ ok: false, error: 'missing_credentials' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    const code = classifyAuthError(error)
    const status = code === 'rate_limited' ? 429 : code === 'auth_unavailable' ? 503 : 401
    // 未知錯誤一律當成帳密錯誤回覆，避免透露帳號是否存在
    const safe = ['email_not_confirmed', 'rate_limited', 'auth_unavailable', 'account_suspended'].includes(code) ? code : 'invalid_credentials'
    return NextResponse.json({ ok: false, error: safe }, { status })
  }

  const { data: profile, error: profileError } = await supabase
    .from('app_user_profiles')
    .select('is_active, is_deleted')
    .eq('id', data.user.id)
    .maybeSingle()

  const block = profileError ? null : profileLoginBlock(profile as { is_active?: boolean | null; is_deleted?: boolean | null } | null)
  if (block) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: block }, { status: 403 })
  }

  // cookies 已由 createServerClient 的 cookies.setAll 寫入（httpOnly），前端只需導頁
  return NextResponse.json({ ok: true })
}
