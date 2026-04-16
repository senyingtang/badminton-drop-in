/**
 * NEXT_PUBLIC_* 於建置時內嵌至前端；須為「非空字串」才算已設定。
 */

function isNonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

export function hasPublicSupabaseConfig(): boolean {
  return isNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL) && isNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function getPublicSupabaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!u) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL 未設定或為空白')
  }
  return u
}

export function getPublicSupabaseAnonKey(): string {
  const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!k) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY 未設定或為空白')
  }
  return k
}

/** 本機 `supabase start` 預設 API port */
export const DEV_LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'

/**
 * 本機開發用預設 anon JWT（與 Supabase CLI 文件範例一致）。
 * 仍建議在 .env.local 覆寫 NEXT_PUBLIC_SUPABASE_ANON_KEY。
 */
export const DEV_LOCAL_SUPABASE_ANON_FALLBACK =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
