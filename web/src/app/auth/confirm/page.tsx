// Supabase Email 範本建議使用：{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup（或 recovery）
// 與 /auth/callback 共用同一套處理（token_hash 驗證不需 PKCE verifier，可跨裝置開啟）。
export { default } from '../callback/page'
