/**
 * Demo Preview（測試預覽）隔離模式。
 *
 * 只有在建置時同時滿足以下兩個條件才會啟用：
 *   NEXT_PUBLIC_DEMO_PREVIEW = "1"
 *   NEXT_PUBLIC_SUPABASE_URL = DEMO_SUPABASE_URL（保留的 .invalid 網域，不存在真實主機）
 *
 * 因為 Supabase URL 必須是假網址，Demo 模式不可能與真實（正式或 Staging）Supabase 同時存在；
 * 正式站建置使用真實 URL，所以永遠不會進入 Demo 模式。
 * 啟用後所有 Supabase 請求都由 demoFetch 在本機以假資料回應：只讀、不連網、拒絕所有寫入。
 */
export const DEMO_SUPABASE_URL = 'https://demo-preview.invalid'

/** Demo 測試身分（只在 Demo 假後端有效，與任何真實帳號無關） */
export const DEMO_LOGIN_EMAIL = 'demo@example.test'
export const DEMO_LOGIN_PASSWORD = 'demo-preview'
export const DEMO_SHARE_CODE = 'DEMO2026'

export function isDemoPreview(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_PREVIEW === '1' &&
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim() === DEMO_SUPABASE_URL
  )
}
