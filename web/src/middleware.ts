import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl, hasPublicSupabaseConfig } from '@/lib/supabase/env'

/**
 * 每一次對 Supabase（Auth / PostgREST）的請求上限。
 * 原本沒有逾時：Supabase 變慢時 middleware 會一直等，在 Vercel 上就成為
 * 504 MIDDLEWARE_INVOCATION_TIMEOUT。逾時後一律「視為未驗證」（fail-closed）。
 */
const SUPABASE_FETCH_TIMEOUT_MS = 4000

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

const MANAGEMENT_ROLES = new Set(['platform_admin', 'venue_owner', 'host'])

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // 未完整設定時略過 session，避免 Edge 層拋錯導致全站 500（正式站應於部署平台填好變數）
  if (!hasPublicSupabaseConfig()) {
    return supabaseResponse
  }

  const supabaseUrl = getPublicSupabaseUrl()
  const supabaseAnon = getPublicSupabaseAnonKey()

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    global: { fetch: fetchWithTimeout },
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

  /**
   * 導向時必須帶上 @supabase/ssr 剛刷新／清除的 Cookie。
   * 原本直接 `NextResponse.redirect()` 會丟掉 Set-Cookie：伺服端已輪替 refresh token，
   * 瀏覽器卻仍持有舊 token，下一次請求就會重複刷新、甚至被判定重用而登出。
   */
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c))
    return res
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/auth', '/', '/pricing', '/terms', '/privacy']
  const isPublicPath =
    publicPaths.some((p) => path === p || path.startsWith('/auth/')) ||
    path.startsWith('/s/') ||
    path.startsWith('/signup/') ||
    path.startsWith('/api/') ||
    path === '/liff-entry' ||
    path.startsWith('/liff-entry/') ||
    path.startsWith('/liff/')

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    // 保留原始路徑與 query，讓登入後可導回原頁
    loginUrl.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return redirectTo(loginUrl)
  }

  if (!user) return supabaseResponse

  // 權限：/dashboard 等屬於「後台/管理」路由，僅管理權限可進
  const managementPrefixes = ['/dashboard', '/sessions', '/venues', '/pickup-group', '/players', '/billing', '/settings']
  const isManagementPath = managementPrefixes.some((p) => path === p || path.startsWith(p + '/'))
  const isAuthEntryPath = path === '/login' || path === '/register'

  if (!isManagementPath && !isAuthEntryPath) return supabaseResponse

  // 讀 primary_role 以決定是否允許進入管理後台（同一請求只查一次）
  const { data: profile, error: profileError } = await supabase
    .from('app_user_profiles')
    .select('primary_role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    // 查不到角色（逾時／網路錯誤）時不可放行管理頁，也不可把團主誤導到會員中心。
    if (isManagementPath) {
      return new NextResponse('暫時無法驗證帳號權限，請稍後重新整理。', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': '5',
          'Cache-Control': 'no-store',
        },
      })
    }
    // /login、/register：直接顯示頁面即可
    return supabaseResponse
  }

  const isManagementRole = MANAGEMENT_ROLES.has(String(profile?.primary_role ?? ''))

  if (isManagementPath && !isManagementRole) {
    const url = request.nextUrl.clone()
    url.pathname = '/member-dashboard'
    url.search = ''
    return redirectTo(url)
  }

  if (isAuthEntryPath) {
    // 登入後導向：依角色決定（管理者->/dashboard，一般球友->/member-dashboard）
    const nextUrl = request.nextUrl.clone()
    nextUrl.pathname = isManagementRole ? '/dashboard' : '/member-dashboard'
    return redirectTo(nextUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
