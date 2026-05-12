/**
 * 公開報名分享連結（團主複製、臨打列表等）。
 * LIFF 入口：`/liff-entry?returnTo=/s/{code}`（returnTo 為站內路徑）。
 */

export function signupPublicPath(shareSignupCode: string): string {
  return `/s/${encodeURIComponent(shareSignupCode)}`
}

/** 社群／LINE App 優先報名入口（相對路徑） */
export function liffQuickSignupEntryPath(shareSignupCode: string): string {
  return `/liff-entry?returnTo=${encodeURIComponent(signupPublicPath(shareSignupCode))}`
}

export function absoluteUrl(origin: string, path: string): string {
  const base = origin.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}
