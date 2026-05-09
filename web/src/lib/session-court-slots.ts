/**
 * 面場排序（sort_order 1..N）對應實際場地編號（如 2、3 號），供輪次管理顯示與排組 RPC。
 */

export type SessionCourtSlot = {
  sortOrder: number
  courtNo: number
  label: string | null
}

export function formatCourtSlotTitle(slot: SessionCourtSlot): string {
  const courtNo = Number(slot.courtNo)
  const base = `${courtNo} 號場`
  const label = slot.label?.trim() || ''
  if (!label) return base

  // 避免「5 號・5號場」這種重複：label 若等同「{N}號場」就只顯示 base
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const labelN = normalize(label)
  const redundant1 = normalize(`${courtNo}號場`)
  const redundant2 = normalize(`${courtNo} 號場`)
  if (labelN === redundant1 || labelN === redundant2) return base

  return `${base}・${label}`
}

/** 由 Supabase 嵌套查詢 `session_courts` 列或 metadata fallback 產生 slots */
export function buildSessionCourtSlots(
  rows: Array<{ sort_order: number; court_no: number; label: string | null }> | null | undefined,
  courtCount: number,
  metadata: unknown
): SessionCourtSlot[] {
  if (rows && rows.length > 0) {
    return [...rows]
      .map((r) => ({
        sortOrder: Number(r.sort_order),
        courtNo: Number(r.court_no),
        label: r.label,
      }))
      .filter((r) => Number.isFinite(r.sortOrder) && Number.isFinite(r.courtNo))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const nosRaw = m.rented_court_nos ?? m.rented_court_numbers
  const labelsRaw = m.rented_court_labels
  const n = Math.max(1, Math.floor(Number(courtCount) || 1))

  if (Array.isArray(nosRaw) && nosRaw.length > 0) {
    const slots: SessionCourtSlot[] = []
    const len = Math.max(n, nosRaw.length)
    for (let i = 0; i < len; i++) {
      const raw = nosRaw[i]
      const num = typeof raw === 'number' ? raw : Number(raw)
      const courtNo = Number.isFinite(num) && num > 0 ? num : i + 1
      const lab =
        Array.isArray(labelsRaw) && typeof labelsRaw[i] === 'string'
          ? (labelsRaw[i] as string).trim() || null
          : null
      slots.push({ sortOrder: i + 1, courtNo, label: lab })
    }
    return slots
  }

  return Array.from({ length: n }, (_, i) => ({
    sortOrder: i + 1,
    courtNo: i + 1,
    label: null,
  }))
}
