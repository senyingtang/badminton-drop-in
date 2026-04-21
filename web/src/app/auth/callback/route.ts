import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // 若是 LINE（Custom OIDC）登入，將 OIDC 的 sub 寫入 players.line_user_id；
      // 並確保登入使用者一定有一筆 players（避免公開報名頁卡住「請先建立球員資料」）
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const identities = (user as any)?.identities as any[] | undefined
        const lineIdentity = identities?.find(
          (i) =>
            i?.provider === 'custom:line-login' ||
            i?.provider === 'line' ||
            (typeof i?.provider === 'string' && i.provider.includes('line'))
        )
        const lineSub =
          (typeof lineIdentity?.identity_data?.sub === 'string' && lineIdentity.identity_data.sub) ||
          (typeof lineIdentity?.id === 'string' ? lineIdentity.id : '')
        if (user?.id) {
          const admin = createServiceRoleClient()
          if (admin) {
            const { data: existing } = await admin
              .from('players')
              .select('id, line_user_id')
              .eq('auth_user_id', user.id)
              .maybeSingle()

            if (!existing) {
              const codeNoDash = String(user.id).replace(/-/g, '')
              const playerCode = `u${codeNoDash}` // 僅英數，符合 is_valid_player_code
              const displayName =
                (typeof (user as any)?.user_metadata?.display_name === 'string' &&
                  (user as any).user_metadata.display_name.trim()) ||
                (typeof user.email === 'string' ? user.email.split('@')[0] : '') ||
                '球友'

              // 若 player_code 撞到（極罕見），再用隨機碼 fallback
              const fallbackCode = `u${crypto.randomUUID().replace(/-/g, '')}`

              const { error: insErr } = await admin.from('players').insert({
                auth_user_id: user.id,
                player_code: playerCode,
                display_name: displayName,
              })
              if (insErr) {
                await admin.from('players').insert({
                  auth_user_id: user.id,
                  player_code: fallbackCode,
                  display_name: displayName,
                })
              }
            }

            if (lineSub) {
              await admin.from('players').update({ line_user_id: lineSub }).eq('auth_user_id', user.id)
            }
          }
        }
      } catch {
        // ignore：不影響登入
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // If no code or error, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
