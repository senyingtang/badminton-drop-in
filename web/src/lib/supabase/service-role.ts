import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPublicSupabaseUrl } from '@/lib/supabase/env'
import { isDemoPreview } from '@/lib/demo/demoPreview'

/** 伺服端專用（需環境變數 SUPABASE_SERVICE_ROLE_KEY）；缺少時回傳 null */
export function createServiceRoleClient(): SupabaseClient | null {
  // 測試預覽沒有 service_role：所有需要它的 API 走既有的「未設定」路徑
  if (isDemoPreview()) return null
  const url = getPublicSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
