/** Shared session → fee / report date helpers for operations report APIs */

export function sessionFeeTwd(session: { fee_twd?: unknown; metadata?: unknown }): number {
  const m = session.metadata
  if (m && typeof m === 'object' && (m as { fee_twd?: unknown }).fee_twd != null) {
    const n = Number((m as { fee_twd?: unknown }).fee_twd)
    if (Number.isFinite(n)) return n
  }
  if (session.fee_twd != null) return Number(session.fee_twd)
  return 0
}

export function reportDateTaipei(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
