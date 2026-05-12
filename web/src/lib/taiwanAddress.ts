/**
 * 臨打列表用：由場館 city / district 或 address_text 推導縣市、區域（顯示分組）。
 * 無法解析時：city = 「其他地區」、district = 「未分類」。
 */

const FALLBACK_CITY = '其他地區'
const FALLBACK_DISTRICT = '未分類'

/** 由長到短排序，避免「新竹縣」被「新竹市」前綴誤判等（新竹縣／新竹市同長，需兩者皆保留） */
const TW_COUNTIES: string[] = [
  '臺北市',
  '台北市',
  '新北市',
  '桃園市',
  '臺中市',
  '台中市',
  '臺南市',
  '台南市',
  '高雄市',
  '基隆市',
  '新竹市',
  '嘉義市',
  '新竹縣',
  '苗栗縣',
  '彰化縣',
  '南投縣',
  '雲林縣',
  '嘉義縣',
  '屏東縣',
  '宜蘭縣',
  '花蓮縣',
  '臺東縣',
  '台東縣',
  '澎湖縣',
  '金門縣',
  '連江縣',
]

const TW_COUNTY_CANON: Record<string, string> = {
  臺北市: '台北市',
  台北市: '台北市',
  臺中市: '台中市',
  台中市: '台中市',
  臺南市: '台南市',
  台南市: '台南市',
  臺東縣: '台東縣',
  台東縣: '台東縣',
}

function canonicalCity(name: string): string {
  return TW_COUNTY_CANON[name] ?? name
}

/** 英文常見對照（大小寫不敏感） */
const EN_CITY: Array<{ pattern: RegExp; zh: string }> = [
  { pattern: /\bnew\s+taipei\s+city\b/i, zh: '新北市' },
  { pattern: /\btaipei\s+city\b/i, zh: '台北市' },
  { pattern: /\btaoyuan\s+city\b/i, zh: '桃園市' },
  { pattern: /\btaichung\s+city\b/i, zh: '台中市' },
  { pattern: /\btainan\s+city\b/i, zh: '台南市' },
  { pattern: /\bkaohsiung\s+city\b/i, zh: '高雄市' },
]

const EN_DISTRICT: Array<{ pattern: RegExp; zh: string }> = [
  { pattern: /\bzhongli\s+district\b/i, zh: '中壢區' },
  { pattern: /\blinkou\s+district\b/i, zh: '林口區' },
  { pattern: /\bxinzhuang\s+district\b/i, zh: '新莊區' },
]

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function stripLeadingPostal(text: string): string {
  return text.replace(/^\d{3}\s*/, '').trim()
}

function findTwCountyInText(text: string): { raw: string; index: number } | null {
  let best: { raw: string; index: number; len: number } | null = null
  for (const county of TW_COUNTIES) {
    const idx = text.indexOf(county)
    if (idx < 0) continue
    if (
      !best ||
      idx < best.index ||
      (idx === best.index && county.length > best.len) ||
      (idx === best.index && county.length === best.len && county > best.raw)
    ) {
      best = { raw: county, index: idx, len: county.length }
    }
  }
  if (!best) return null
  return { raw: best.raw, index: best.index }
}

/** 縣市名之後擷取第一個「XX區／鄉／鎮／縣轄市」 */
function extractChineseDistrictAfterCity(text: string, cityEndIndex: number): string | null {
  const after = text.slice(cityEndIndex)
  const m = after.match(/^([\u4e00-\u9fff]{1,8}?(區|鄉|鎮|市))/)
  if (!m) return null
  const raw = m[1]
  // 避免把「桃園市」的「市」當區名：區塊應緊接在完整縣市後
  if (raw === '市' || raw.length < 2) return null
  return raw
}

function parseEnglishAddress(text: string): { city: string; district: string } | null {
  let city: string | null = null
  let district: string | null = null
  for (const { pattern, zh } of EN_CITY) {
    if (pattern.test(text)) {
      city = zh
      break
    }
  }
  for (const { pattern, zh } of EN_DISTRICT) {
    if (pattern.test(text)) {
      district = zh
      break
    }
  }
  if (city && district) return { city: canonicalCity(city), district }
  if (district && !city) return { city: FALLBACK_CITY, district }
  if (city && !district) return { city: canonicalCity(city), district: FALLBACK_DISTRICT }
  return null
}

function hasLatinLetters(text: string): boolean {
  return /[A-Za-z]/.test(text)
}

/**
 * @param addressText venues.address_text
 * @param city venues.city
 * @param district venues.district
 */
export function parseTaiwanAddress(
  addressText: string | null | undefined,
  city: string | null | undefined,
  district: string | null | undefined
): { city: string; district: string } {
  const c0 = typeof city === 'string' ? city.trim() : ''
  const d0 = typeof district === 'string' ? district.trim() : ''
  if (c0 && d0) {
    return { city: canonicalCity(c0), district: d0 }
  }

  const rawTextEarly = typeof addressText === 'string' ? addressText : ''
  const textEarly = normalizeWhitespace(stripLeadingPostal(rawTextEarly))
  if (!c0 && d0 && textEarly) {
    const county = findTwCountyInText(textEarly)
    if (county) return { city: canonicalCity(county.raw), district: d0 }
    return { city: FALLBACK_CITY, district: d0 }
  }

  const rawText = typeof addressText === 'string' ? addressText : ''
  const text = normalizeWhitespace(stripLeadingPostal(rawText))

  if (c0 && !d0 && text) {
    const county = findTwCountyInText(text)
    if (county && canonicalCity(county.raw) === canonicalCity(c0)) {
      const dist = extractChineseDistrictAfterCity(text, county.index + county.raw.length)
      if (dist) return { city: canonicalCity(c0), district: dist }
    }
    if (c0) return { city: canonicalCity(c0), district: FALLBACK_DISTRICT }
  }

  if (!text) {
    if (c0) return { city: canonicalCity(c0), district: d0 || FALLBACK_DISTRICT }
    return { city: FALLBACK_CITY, district: FALLBACK_DISTRICT }
  }

  if (hasLatinLetters(text)) {
    const en = parseEnglishAddress(text)
    if (en) return en
  }

  const county = findTwCountyInText(text)
  if (county) {
    const canonCity = canonicalCity(county.raw)
    const dist = extractChineseDistrictAfterCity(text, county.index + county.raw.length)
    if (dist) return { city: canonCity, district: dist }
    return { city: canonCity, district: FALLBACK_DISTRICT }
  }

  return { city: FALLBACK_CITY, district: FALLBACK_DISTRICT }
}
