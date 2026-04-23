import { createBrowserClient } from '@supabase/ssr'
import {
  DEV_LOCAL_SUPABASE_ANON_FALLBACK,
  DEV_LOCAL_SUPABASE_URL,
  getPublicSupabaseAnonKey,
  getPublicSupabaseUrl,
  hasPublicSupabaseConfig,
} from './env'

function parseDocumentCookies(): Array<{ name: string; value: string }> {
  if (typeof document === 'undefined') return []
  const raw = document.cookie || ''
  if (!raw) return []
  return raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      const name = i >= 0 ? pair.slice(0, i) : pair
      const value = i >= 0 ? pair.slice(i + 1) : ''
      return { name, value }
    })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setDocumentCookie(name: string, value: string, options: any) {
  if (typeof document === 'undefined') return
  let cookie = `${name}=${value}`
  if (options?.maxAge != null) cookie += `; Max-Age=${options.maxAge}`
  if (options?.expires) cookie += `; Expires=${new Date(options.expires).toUTCString()}`
  cookie += `; Path=${options?.path || '/'}`
  if (options?.domain) cookie += `; Domain=${options.domain}`
  if (options?.sameSite) cookie += `; SameSite=${options.sameSite}`
  if (options?.secure) cookie += `; Secure`
  // httpOnly 無法由瀏覽器端設定；@supabase/ssr 在瀏覽器端會用非 httpOnly cookie
  document.cookie = cookie
}

export function createClient() {
  if (hasPublicSupabaseConfig()) {
    return createBrowserClient(getPublicSupabaseUrl(), getPublicSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return parseDocumentCookies()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => setDocumentCookie(name, value, options))
        },
      },
    })
  }

  // next dev、或測試時非 production — 允許連本機 Supabase，避免誤用 localhost 當正式站後端
  if (process.env.NODE_ENV !== 'production') {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || DEV_LOCAL_SUPABASE_ANON_FALLBACK
    return createBrowserClient(DEV_LOCAL_SUPABASE_URL, key, {
      cookies: {
        getAll() {
          return parseDocumentCookies()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => setDocumentCookie(name, value, options))
        },
      },
    })
  }

  throw new Error(
    '缺少 Supabase 公開環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY（須為非空字串）。若部署於 Vercel，請於專案 Environment Variables 設定後重新部署。'
  )
}
