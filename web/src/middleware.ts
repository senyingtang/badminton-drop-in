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
  const publicPaths = ['/login', '/register', '/auth', '/', '/pricing', '/terms', '/privacy']
  const isPublicPath =
    publicPaths.some((p) => path === p || path.startsWith('/auth/')) ||
    path.startsWith('/s/') ||
    path.startsWith('/signup/') ||
    path.startsWith('/api/')

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    const dashUrl = request.nextUrl.clone()
    dashUrl.pathname = '/dashboard'
    return NextResponse.redirect(dashUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
