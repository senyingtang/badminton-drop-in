import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl, hasPublicSupabaseConfig } from '@/lib/supabase/env'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // 未完整設定時略過 session，避免 Edge 層拋錯導致全站 500（正式站應於 Vercel 填好變數）
  if (!hasPublicSupabaseConfig()) {
    return supabaseResponse
  }

  const supabaseUrl = getPublicSupabaseUrl()
  const supabaseAnon = getPublicSupabaseAnonKey()

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/auth', '/', '/pricing', '/terms', '/privacy']
  const isPublicPath =
    publicPaths.some((p) => path === p || path.startsWith('/auth/')) ||
    path.startsWith('/s/') ||
    path.startsWith('/signup/') ||
    path.startsWith('/api/')

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    // 保留原始路徑與 query，讓登入後可導回原頁
    loginUrl.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  // 權限：/dashboard 等屬於「後台/管理」路由，僅管理權限可進
  const managementPrefixes = ['/dashboard', '/sessions', '/venues', '/pickup-group', '/players', '/billing', '/settings']
  const isManagementPath = managementPrefixes.some((p) => path === p || path.startsWith(p + '/'))
  const isMemberPath = path === '/member-dashboard' || path.startsWith('/member-dashboard/')

  if (user) {
    // 讀 primary_role 以決定是否允許進入管理後台
    const { data: profile } = await supabase
      .from('app_user_profiles')
      .select('primary_role')
      .eq('id', user.id)
      .maybeSingle()

    const role = profile?.primary_role
    const isManagementRole = role === 'platform_admin' || role === 'venue_owner' || role === 'host'

    if (!isManagementRole && isManagementPath) {
      const url = request.nextUrl.clone()
      url.pathname = '/member-dashboard'
      url.search = ''
      return NextResponse.redirect(url)
    }

    // 若是管理者誤進會員中心，也允許（不強制導走），避免使用情境被限制
    // if (isManagementRole && isMemberPath) { ... }
  }

  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    // 登入後導向：依角色決定（管理者->/dashboard，一般球友->/member-dashboard）
    const { data: profile } = await supabase
      .from('app_user_profiles')
      .select('primary_role')
      .eq('id', user.id)
      .maybeSingle()

    const role = profile?.primary_role
    const isManagementRole = role === 'platform_admin' || role === 'venue_owner' || role === 'host'

    const nextUrl = request.nextUrl.clone()
    nextUrl.pathname = isManagementRole ? '/dashboard' : '/member-dashboard'
    return NextResponse.redirect(nextUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
