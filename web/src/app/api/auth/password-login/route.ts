import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { email?: string; password?: string } | null = null
  try {
    body = (await req.json()) as { email?: string; password?: string }
  } catch {
    body = null
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'missing_credentials' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 })
  }

  // cookies 已由 createServerClient 的 cookies.setAll 寫入（httpOnly），前端只需導頁
  return NextResponse.json({ ok: true })
}

