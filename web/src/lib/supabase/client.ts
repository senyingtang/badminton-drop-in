import { createBrowserClient } from '@supabase/ssr'
import {
  DEV_LOCAL_SUPABASE_ANON_FALLBACK,
  DEV_LOCAL_SUPABASE_URL,
  getPublicSupabaseAnonKey,
  getPublicSupabaseUrl,
  hasPublicSupabaseConfig,
} from './env'

export function createClient() {
  if (hasPublicSupabaseConfig()) {
    return createBrowserClient(getPublicSupabaseUrl(), getPublicSupabaseAnonKey())
  }

  // next dev、或測試時非 production — 允許連本機 Supabase，避免誤用 localhost 當正式站後端
  if (process.env.NODE_ENV !== 'production') {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || DEV_LOCAL_SUPABASE_ANON_FALLBACK
    return createBrowserClient(DEV_LOCAL_SUPABASE_URL, key)
  }

  throw new Error(
    '缺少 Supabase 公開環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY（須為非空字串）。若部署於 Vercel，請於專案 Environment Variables 設定後重新部署。'
  )
}
