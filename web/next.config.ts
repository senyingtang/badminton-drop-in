import type { NextConfig } from 'next'

/**
 * 在 Vercel 上建置時強制檢查 Supabase 公開變數，避免「建置成功、上線後登入 Failed to fetch」
 * （例如誤用本機 URL 或空白字串）。
 */
function assertVercelSupabasePublicEnv(): void {
  if (process.env.VERCEL !== '1') return

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) {
    throw new Error(
      'Vercel 建置缺少或空白：NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY。請於專案 Environment Variables（Production / Preview 視需求）設定非空值後重新部署。'
    )
  }
}

assertVercelSupabasePublicEnv()

const nextConfig: NextConfig = {
  reactCompiler: true,
}

export default nextConfig
