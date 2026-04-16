import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  DEV_LOCAL_SUPABASE_ANON_FALLBACK,
  DEV_LOCAL_SUPABASE_URL,
  getPublicSupabaseAnonKey,
  getPublicSupabaseUrl,
  hasPublicSupabaseConfig,
} from './env'

export async function createClient() {
  const cookieStore = await cookies()

  if (hasPublicSupabaseConfig()) {
    return createServerClient(getPublicSupabaseUrl(), getPublicSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    })
  }

  if (process.env.NODE_ENV !== 'production') {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || DEV_LOCAL_SUPABASE_ANON_FALLBACK
    return createServerClient(DEV_LOCAL_SUPABASE_URL, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    })
  }

  throw new Error(
    '缺少 Supabase 公開環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY（須為非空字串）。若部署於 Vercel，請於專案 Environment Variables 設定後重新部署。'
  )
}
