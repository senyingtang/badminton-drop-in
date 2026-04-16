export type ThemePresetId = 'indigo' | 'emerald' | 'sunset' | 'ocean' | 'mono' | 'custom'

export type ThemeCustom = Partial<{
  brand_start: string
  brand_end: string
  bg_primary: string
  bg_secondary: string
  text_primary: string
  text_secondary: string
}>

export function themePresetVars(preset: Exclude<ThemePresetId, 'custom'>): Record<string, string> {
  switch (preset) {
    case 'indigo':
      return { '--brand-start': '#6366f1', '--brand-end': '#8b5cf6' }
    case 'emerald':
      return { '--brand-start': '#10b981', '--brand-end': '#34d399' }
    case 'sunset':
      return { '--brand-start': '#f97316', '--brand-end': '#ec4899' }
    case 'ocean':
      return { '--brand-start': '#0ea5e9', '--brand-end': '#22c55e' }
    case 'mono':
      return {
        '--brand-start': '#e5e7eb',
        '--brand-end': '#a3a3a3',
        '--bg-primary': '#0b0b0f',
        '--bg-secondary': '#121218',
        '--text-primary': '#f3f4f6',
        '--text-secondary': '#c7c7d1',
      }
    default:
      return {}
  }
}

export function themeCustomVars(custom: ThemeCustom | null | undefined): Record<string, string> {
  const c = custom || {}
  const vars: Record<string, string> = {}
  const map: Array<[keyof ThemeCustom, string]> = [
    ['brand_start', '--brand-start'],
    ['brand_end', '--brand-end'],
    ['bg_primary', '--bg-primary'],
    ['bg_secondary', '--bg-secondary'],
    ['text_primary', '--text-primary'],
    ['text_secondary', '--text-secondary'],
  ]
  for (const [k, cssVar] of map) {
    const v = c[k]
    if (typeof v === 'string' && v.trim()) vars[cssVar] = v.trim()
  }
  return vars
}

