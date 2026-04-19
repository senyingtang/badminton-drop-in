/** 主辦仍可調整場次內容（時間、場地數、地點等）的狀態 — 與 DB 觸發器「已結束／已取消鎖定」搭配 */
export const HOST_EDITABLE_SESSION_STATUSES = [
  'draft',
  'pending_confirmation',
  'ready_for_assignment',
  'assigned',
  'in_progress',
  'round_finished',
] as const

export type HostEditableSessionStatus = (typeof HOST_EDITABLE_SESSION_STATUSES)[number]

export function isHostEditableSessionStatus(status: string): boolean {
  return (HOST_EDITABLE_SESSION_STATUSES as readonly string[]).includes(status)
}
