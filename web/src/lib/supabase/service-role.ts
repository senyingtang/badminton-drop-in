import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPublicSupabaseUrl } from '@/lib/supabase/env'

/** 伺服端專用（需環境變數 SUPABASE_SERVICE_ROLE_KEY）；缺少時回傳 null */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = getPublicSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
