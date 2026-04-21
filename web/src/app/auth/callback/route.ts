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
      // 若是 LINE（Custom OIDC）登入，將 OIDC 的 sub 寫入 players.line_user_id
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
        if (user?.id && lineSub) {
          const admin = createServiceRoleClient()
          if (admin) {
            await admin.from('players').update({ line_user_id: lineSub }).eq('auth_user_id', user.id)
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
