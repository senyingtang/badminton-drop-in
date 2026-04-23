import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * 用於線上除錯：確認伺服端是否能從 cookie 讀到登入 session。
 * - 若 hasUser=false，通常代表 cookie 未寫入/被瀏覽器擋下，或網域/部署不一致。
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  return NextResponse.json({
    ok: true,
    hasUser: !!user,
    user: user
      ? {
          id: user.id,
          email: user.email,
        }
      : null,
    error: error?.message || null,
  })
}

