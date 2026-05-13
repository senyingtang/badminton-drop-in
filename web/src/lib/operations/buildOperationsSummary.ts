/** 總覽「營運報表」圖表與 KPI 聚合（不依賴 DB schema 變更）。 */

export type OperationsSummaryRange = 'per_session' | 'monthly' | 'quarter' | 'half_year' | 'year'

export function parseOperationsSummaryRange(s: string | null): OperationsSummaryRange {
  const allowed: OperationsSummaryRange[] = ['per_session', 'monthly', 'quarter', 'half_year', 'year']
  if (s && allowed.includes(s as OperationsSummaryRange)) return s as OperationsSummaryRange
  return 'per_session'
}

export type RawOpReport = {
  id: string
  session_id: string
  report_date: string | null
  created_at: string
  gross_revenue_cents: number | string | null
  venue_cost_cents?: number | string | null
  shuttlecock_cost_cents: number | string | null
  other_expense_cents: number | string | null
  net_revenue_cents: number | string | null
}

export type ChartPoint = {
  label: string
  date: string
  gross_revenue_cents: number
  total_expense_cents: number
  net_revenue_cents: number
  session_title: string | null
}

export type SummaryStats = {
  report_count: number
  gross_revenue_cents: number
  total_expense_cents: number
  net_revenue_cents: number
  latest_net_revenue_cents: number
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function rowTotalExpenseCents(r: RawOpReport): number {
  return num(r.venue_cost_cents) + num(r.shuttlecock_cost_cents) + num(r.other_expense_cents)
}

function effectiveYmd(r: RawOpReport): string {
  if (r.report_date && String(r.report_date).length >= 10) {
    return String(r.report_date).slice(0, 10)
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(r.created_at))
}

function effectiveTs(r: RawOpReport): number {
  const ymd = effectiveYmd(r)
  return new Date(`${ymd}T12:00:00+08:00`).getTime()
}

function labelMdFromYmd(ymd: string): string {
  const m = ymd.slice(5, 7)
  const d = ymd.slice(8, 10)
  return `${m}/${d}`
}

function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7)
}

function labelYm(key: string): string {
  const [y, m] = key.split('-')
  return `${y}/${m}`
}

/** 目前台北曆的連續 n 個月份 key（由舊到新） */
function lastNCalendarMonthKeysFromTaipei(n: number): string[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  let y = Number(parts.find((p) => p.type === 'year')?.value ?? 0)
  let m = Number(parts.find((p) => p.type === 'month')?.value ?? 0)
  const keys: string[] = []
  for (let i = 0; i < n; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m < 1) {
      m = 12
      y -= 1
    }
  }
  return keys
}

/** 最近 n 天（台北日曆）的 ymd，由舊到新 */
function enumerateLastNDaysYmdTaipei(n: number): string[] {
  const out: string[] = []
  let cur = new Date()
  for (let i = 0; i < n; i++) {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(cur)
    out.push(ymd)
    cur = new Date(cur.getTime() - 24 * 60 * 60 * 1000)
  }
  return out.reverse()
}

function sumStats(rows: RawOpReport[]): SummaryStats {
  let gross = 0
  let exp = 0
  let net = 0
  for (const r of rows) {
    gross += num(r.gross_revenue_cents)
    exp += rowTotalExpenseCents(r)
    net += num(r.net_revenue_cents)
  }
  const latest = rows.length ? num(rows[rows.length - 1].net_revenue_cents) : 0
  return {
    report_count: rows.length,
    gross_revenue_cents: gross,
    total_expense_cents: exp,
    net_revenue_cents: net,
    latest_net_revenue_cents: latest,
  }
}

export function buildOperationsSummary(
  range: OperationsSummaryRange,
  rows: RawOpReport[],
  sessionTitleById: Record<string, string>,
): { range: OperationsSummaryRange; stats: SummaryStats; chart_points: ChartPoint[] } {
  if (!rows.length) {
    return {
      range,
      stats: {
        report_count: 0,
        gross_revenue_cents: 0,
        total_expense_cents: 0,
        net_revenue_cents: 0,
        latest_net_revenue_cents: 0,
      },
      chart_points: [],
    }
  }

  if (range === 'per_session') {
    const sortedDesc = [...rows].sort((a, b) => effectiveTs(b) - effectiveTs(a))
    const picked = sortedDesc.slice(0, 12)
    const sortedAsc = [...picked].sort((a, b) => effectiveTs(a) - effectiveTs(b))
    const chart_points: ChartPoint[] = sortedAsc.map((r) => {
      const ymd = effectiveYmd(r)
      return {
        label: labelMdFromYmd(ymd),
        date: ymd,
        gross_revenue_cents: num(r.gross_revenue_cents),
        total_expense_cents: rowTotalExpenseCents(r),
        net_revenue_cents: num(r.net_revenue_cents),
        session_title: sessionTitleById[r.session_id] ?? null,
      }
    })
    const stats = sumStats(sortedAsc)
    stats.latest_net_revenue_cents =
      chart_points.length > 0 ? chart_points[chart_points.length - 1].net_revenue_cents : 0
    return { range, stats, chart_points }
  }

  const monthKeysN = range === 'quarter' ? 3 : range === 'half_year' ? 6 : range === 'year' ? 12 : 0

  if (range === 'monthly') {
    const daySet = new Set(enumerateLastNDaysYmdTaipei(30))
    const windowRows = rows.filter((r) => daySet.has(effectiveYmd(r)))
    const byDay = new Map<string, { gross: number; exp: number; net: number }>()
    for (const r of windowRows) {
      const ymd = effectiveYmd(r)
      const cur = byDay.get(ymd) || { gross: 0, exp: 0, net: 0 }
      cur.gross += num(r.gross_revenue_cents)
      cur.exp += rowTotalExpenseCents(r)
      cur.net += num(r.net_revenue_cents)
      byDay.set(ymd, cur)
    }
    const sortedDays = [...byDay.keys()].sort()
    const chart_points: ChartPoint[] = sortedDays.map((ymd) => {
      const c = byDay.get(ymd)!
      return {
        label: labelMdFromYmd(ymd),
        date: ymd,
        gross_revenue_cents: c.gross,
        total_expense_cents: c.exp,
        net_revenue_cents: c.net,
        session_title: null,
      }
    })
    const stats = sumStats(windowRows)
    stats.latest_net_revenue_cents =
      chart_points.length > 0 ? chart_points[chart_points.length - 1].net_revenue_cents : 0
    return { range, stats, chart_points }
  }

  const monthKeys = lastNCalendarMonthKeysFromTaipei(monthKeysN)
  const monthSet = new Set(monthKeys)
  const windowRows = rows.filter((r) => monthSet.has(monthKeyFromYmd(effectiveYmd(r))))

  const byMonth = new Map<string, { gross: number; exp: number; net: number }>()
  for (const r of windowRows) {
    const mk = monthKeyFromYmd(effectiveYmd(r))
    const cur = byMonth.get(mk) || { gross: 0, exp: 0, net: 0 }
    cur.gross += num(r.gross_revenue_cents)
    cur.exp += rowTotalExpenseCents(r)
    cur.net += num(r.net_revenue_cents)
    byMonth.set(mk, cur)
  }

  const chart_points: ChartPoint[] = monthKeys
    .filter((mk) => byMonth.has(mk))
    .map((mk) => {
      const c = byMonth.get(mk)!
      return {
        label: labelYm(mk),
        date: `${mk}-01`,
        gross_revenue_cents: c.gross,
        total_expense_cents: c.exp,
        net_revenue_cents: c.net,
        session_title: null,
      }
    })

  const stats = sumStats(windowRows)
  stats.latest_net_revenue_cents =
    chart_points.length > 0 ? chart_points[chart_points.length - 1].net_revenue_cents : 0

  return { range, stats, chart_points }
}
