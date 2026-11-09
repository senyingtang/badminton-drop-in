import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl, hasPublicSupabaseConfig } from '@/lib/supabase/env'
import { isDemoPreview } from '@/lib/demo/demoPreview'
import { demoFetch } from '@/lib/demo/demoFetch'
import { isReadonlyPreview, readonlyServerFetch } from '@/lib/readonly/readonlyPreview'
import { isAuthNetworkError, profileLoginBlock } from '@/lib/auth/authPolicy'
import { isSafeInternalReturnPath } from '@/lib/safeInternalReturnPath'
import { isAuthReturnAtRoot } from '@/lib/auth/authNext'

/**
 * 每一次對 Supabase（Auth / PostgREST）的請求上限，避免 504 MIDDLEWARE_INVOCATION_TIMEOUT。
 */
const SUPABASE_FETCH_TIMEOUT_MS = 4000

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

/** 唯讀整合測試：同樣有逾時，並套用唯讀過濾 */
const readonlyFetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return readonlyServerFetch(input, { ...init, signal })
}

const MANAGEMENT_ROLES = new Set(['platform_admin', 'venue_owner', 'host'])
const MANAGEMENT_PREFIXES = ['/dashboard', '/sessions', '/venues', '/pickup-group', '/players', '/billing', '/settings']
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/auth', '/', '/pricing', '/terms', '/privacy']

function isPublic(path: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => path === p) ||
    path.startsWith('/auth/') ||
    path.startsWith('/s/') ||
    path.startsWith('/signup/') ||
    path.startsWith('/api/') ||
    path === '/liff-entry' ||
    path.startsWith('/liff-entry/') ||
    path.startsWith('/liff/')
  )
}

function unavailable(message: string): NextResponse {
  return new NextResponse(message, {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' },
  })
}

export async function middleware(request: NextRequest) {
  // Supabase 回跳落在根路徑（redirectTo 不在白名單時改用 Site URL，或預設範本）→ 交給 /auth/confirm
  if (isAuthReturnAtRoot(request.nextUrl.pathname, request.nextUrl.searchParams)) {
    const u = request.nextUrl.clone()
    u.pathname = '/auth/confirm'
    return NextResponse.redirect(u)
  }

  let supabaseResponse = NextResponse.next({ request })

  // 未完整設定時略過 session，避免 Edge 層拋錯導致全站 500（正式站應於部署平台填好變數）
  if (!hasPublicSupabaseConfig()) return supabaseResponse

  const supabase = createServerClient(getPublicSupabaseUrl(), getPublicSupabaseAnonKey(), {
    global: { fetch: isDemoPreview() ? demoFetch : isReadonlyPreview() ? readonlyFetchWithTimeout : fetchWithTimeout },
    // HTTPS 時 session cookie 加 Secure（@supabase/ssr 預設不加）
    cookieOptions: { secure: request.nextUrl.protocol === 'https:' },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  /** 導向時必須帶上 @supabase/ssr 剛刷新／清除的 Cookie（否則已輪替的 refresh token 會遺失）。 */
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c))
    return res
  }

  const path = request.nextUrl.pathname
  const isPublicPath = isPublic(path)
  const isManagementPath = MANAGEMENT_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))
  const isAuthEntryPath = path === '/login' || path === '/register'

  /**
   * getClaims()：本專案使用非對稱 JWT 簽章金鑰（ES256），在本地以 JWKS（快取）驗章，
   * 不必每個請求打一次 Auth 伺服器（原本 getUser() 每次都連線）。
   * access token 快到期時會先 refresh，新的 Cookie 透過 setAll 寫回回應。
   */
  let userId: string | null = null
  let authDown = false
  try {
    const { data, error } = await supabase.auth.getClaims()
    if (error) {
      if (isAuthNetworkError(error)) authDown = true
    } else if (data?.claims?.sub) {
      userId = String(data.claims.sub)
    }
  } catch (e) {
    authDown = isAuthNetworkError(e as Error)
    if (!authDown) userId = null
  }

  if (authDown) {
    // Auth 暫時逾時 / 無法連線：不得把它當成「未登入」而清除有效 Session 或導去 /login。
    // 公開頁照常顯示（不轉送任何 Cookie 變更），受保護頁回 503 讓使用者重新整理。
    if (isPublicPath) return NextResponse.next({ request })
    return unavailable('登入服務暫時無法連線，請稍後重新整理（您的登入狀態不會被清除）。')
  }

  if (!userId) {
    if (isPublicPath) return supabaseResponse
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    // 保留原始路徑與 query，讓登入後可導回原頁
    loginUrl.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return redirectTo(loginUrl)
  }

  // 已登入：公開頁（登入/註冊頁除外）不需查角色
  if (isPublicPath && !isAuthEntryPath) return supabaseResponse

  // 受保護頁、登入/註冊頁：讀角色與帳號狀態（同一請求只查一次）
  const { data: profile, error: profileError } = await supabase
    .from('app_user_profiles')
    .select('primary_role, is_active, is_deleted')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    // 查不到角色（逾時／網路錯誤）時不可放行管理頁，也不可把團主誤導到會員中心。
    if (isManagementPath) return unavailable('暫時無法驗證帳號權限，請稍後重新整理。')
    // 會員頁 / 登入頁：照常顯示（資料層仍由 RLS 把關）
    return supabaseResponse
  }

  // 停權 / 已刪除：登出並回登入頁（前端隱藏不算數，這裡在伺服端擋）
  const block = profileLoginBlock(profile as { is_active?: boolean | null; is_deleted?: boolean | null } | null)
  if (block) {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      /* 仍會在下方導向；cookie 由 setAll 清除 */
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('reason', block)
    return redirectTo(url)
  }

  const isManagementRole = MANAGEMENT_ROLES.has(String(profile?.primary_role ?? ''))

  if (isManagementPath && !isManagementRole) {
    const url = request.nextUrl.clone()
    url.pathname = '/member-dashboard'
    url.search = ''
    return redirectTo(url)
  }

  if (isAuthEntryPath) {
    // 已登入卻進登入/註冊頁：有安全的站內 returnTo 就回原頁（權限由下一個請求再檢查），否則依角色導向
    const returnTo = request.nextUrl.searchParams.get('returnTo')
    if (isSafeInternalReturnPath(returnTo) && !/^\/(login|register)(\/|\?|$)/.test(returnTo as string)) {
      return redirectTo(new URL(returnTo as string, request.nextUrl.origin))
    }
    const nextUrl = request.nextUrl.clone()
    nextUrl.pathname = isManagementRole ? '/dashboard' : '/member-dashboard'
    nextUrl.search = ''
    return redirectTo(nextUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
