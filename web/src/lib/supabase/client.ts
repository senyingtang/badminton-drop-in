import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // 避免 Vercel build/prerender 在未設定 env 時直接炸掉（仍建議正式環境必填）
  if (!url || !key) {
    return createBrowserClient('http://localhost:54321', 'missing-anon-key')
  }
  return createBrowserClient(
    url,
    key
  )
}
