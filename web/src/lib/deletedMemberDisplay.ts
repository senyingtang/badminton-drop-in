/** 後台／歷史紀錄 join 已軟刪除會員時統一顯示 */
export const DELETED_MEMBER_DISPLAY_LABEL = '此會員已刪除帳號'

export function displayNameForUserProfile(row: {
  display_name?: string | null
  is_deleted?: boolean | null
} | null): string {
  if (!row) return '—'
  if (row.is_deleted) return DELETED_MEMBER_DISPLAY_LABEL
  const n = typeof row.display_name === 'string' ? row.display_name.trim() : ''
  return n || '—'
}
