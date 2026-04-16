/**
 * 場次租借場地：存於 `sessions.metadata`
 * - `rented_court_nos` + `rented_court_labels`：由場館已登錄球場勾選時寫入
 * - `rented_courts_text`：僅手動文字（未勾選或無場館球場時）
 * - `rented_courts_note`：勾選場地時的補充說明（與 `rented_court_nos` 併存）
 */

export const RENTED_COURTS_TEXT_MAX_LENGTH = 200

export function getRentedCourtsDisplay(metadata: unknown): string | null {
  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const note = typeof m.rented_courts_note === 'string' ? m.rented_courts_note.trim() : ''
  const textOnly =
    typeof m.rented_courts_text === 'string'
      ? m.rented_courts_text.trim().slice(0, RENTED_COURTS_TEXT_MAX_LENGTH)
      : ''

  const nosRaw = m.rented_court_nos
  const labelsRaw = m.rented_court_labels
  let base: string | null = null

  if (Array.isArray(nosRaw) && nosRaw.length > 0) {
    const nos = nosRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    if (nos.length > 0) {
      const sorted = [...new Set(nos)].sort((a, b) => a - b)
      if (Array.isArray(labelsRaw) && labelsRaw.length === sorted.length) {
        base = sorted
          .map((no, i) => {
            const lab = labelsRaw[i]
            return typeof lab === 'string' && lab.trim() ? lab.trim() : `${no} 號`
          })
          .join('、')
      } else {
        base = sorted.map((n) => `${n} 號`).join('、')
      }
    }
  }

  if (!base && textOnly) base = textOnly
  if (base && note) return `${base}（${note}）`
  if (note && !base) return note
  return base
}
