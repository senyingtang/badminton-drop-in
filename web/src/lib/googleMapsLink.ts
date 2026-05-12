export type VenueMapLinkInput = {
  venueName?: string | null
  googleMapsUrl?: string | null
  fullAddress?: string | null
  addressText?: string | null
  city?: string | null
  district?: string | null
}

/** 僅允許 http/https，阻擋 javascript: 等。 */
export function safeHttpOrHttpsUrl(raw: string | null | undefined): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return s
}

/**
 * 1) DB 的 google_maps_url 若為合法 http(s) 則直接使用。
 * 2) 否則以 Google Maps search API 產生連結（query 依優先序組合）。
 * 3) 無可用資料時回傳 null。
 */
export function buildVenueGoogleMapsUrl(input: VenueMapLinkInput): string | null {
  const direct = safeHttpOrHttpsUrl(input.googleMapsUrl)
  if (direct) return direct

  const name = (input.venueName || '').trim()
  const full = (input.fullAddress || '').trim()
  const addr = (input.addressText || '').trim()
  const city = (input.city || '').trim()
  const dist = (input.district || '').trim()
  const cityDist = [city, dist].filter(Boolean).join(' ')

  const candidates = [
    [name, full].filter(Boolean).join(' '),
    [name, addr].filter(Boolean).join(' '),
    [name, cityDist].filter(Boolean).join(' ').trim(),
    full,
    addr,
    cityDist,
  ]
    .map((q) => q.trim())
    .filter((q) => q.length > 0)

  const query = candidates[0]
  if (!query) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
