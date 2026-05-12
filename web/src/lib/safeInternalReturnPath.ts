/** 站內導向驗證：防止 open redirect（僅允許以 `/` 開頭的相對路徑）。 */

export function isSafeInternalReturnPath(raw: string | null | undefined): boolean {
  const v = (raw || '').trim()
  if (!v) return false
  if (!v.startsWith('/')) return false
  if (v.startsWith('//')) return false
  if (v.includes('\\')) return false
  if (v.includes('://')) return false
  if (v.includes('@')) return false
  if (/[\u0000-\u001F\u007F]/.test(v)) return false
  return true
}

export function sanitizeInternalReturnPath(raw: string | null | undefined, fallback: string): string {
  return isSafeInternalReturnPath(raw) ? (raw as string).trim() : fallback
}

/** /liff-entry 無效 returnTo 時導向臨打頁（產品規格）。 */
export const LIFF_ENTRY_INVALID_FALLBACK = '/member-dashboard/dropins'

export function sanitizeLiffEntryReturnTo(raw: string | null | undefined): string {
  return sanitizeInternalReturnPath(raw, LIFF_ENTRY_INVALID_FALLBACK)
}
