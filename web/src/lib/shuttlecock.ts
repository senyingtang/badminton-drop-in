/**
 * 場次用球種類：存於 `sessions.metadata.shuttlecock_type`（文字 id）。
 * 圖檔置於 `public/shuttles/`（自管 SVG，避免外連圖床失效或授權爭議）。
 */

export const SHUTTLECOCK_OPTIONS = [
  {
    id: 'plastic_nylon',
    labelZh: '塑膠（尼龍）球',
    hintZh: '常見於社團／臨打',
    imagePath: '/shuttles/plastic.svg',
  },
  {
    id: 'feather_training',
    labelZh: '羽毛球（練習級）',
    hintZh: '羽片／飛行較親民',
    imagePath: '/shuttles/feather_training.svg',
  },
  {
    id: 'feather_tournament',
    labelZh: '羽毛球（比賽級）',
    hintZh: '例如 YY AS-50 等級概念',
    imagePath: '/shuttles/feather_tournament.svg',
  },
  {
    id: 'mixed',
    labelZh: '混合／現場協調',
    hintZh: '依輪次或主辦現場說明',
    imagePath: '/shuttles/mixed.svg',
  },
  {
    id: 'bring_own',
    labelZh: '請自備用球',
    hintZh: '參加者自行攜帶',
    imagePath: '/shuttles/bring_own.svg',
  },
  {
    id: 'unspecified',
    labelZh: '尚未決定',
    hintZh: '主辦將另行公告',
    imagePath: '/shuttles/unspecified.svg',
  },
] as const

export type ShuttlecockTypeId = (typeof SHUTTLECOCK_OPTIONS)[number]['id']

export type ShuttlecockOption = (typeof SHUTTLECOCK_OPTIONS)[number]

const VALID_IDS = new Set<string>(SHUTTLECOCK_OPTIONS.map((o) => o.id))

export function parseShuttlecockTypeFromMetadata(metadata: unknown): ShuttlecockTypeId {
  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const raw = m.shuttlecock_type
  if (typeof raw === 'string' && VALID_IDS.has(raw)) {
    return raw as ShuttlecockTypeId
  }
  return 'unspecified'
}

export function getShuttlecockOptionFromSession(session: { metadata?: unknown }): ShuttlecockOption {
  const id = parseShuttlecockTypeFromMetadata(session?.metadata)
  return SHUTTLECOCK_OPTIONS.find((o) => o.id === id) ?? SHUTTLECOCK_OPTIONS[5]
}

export const DEFAULT_SHUTTLECOCK_TYPE: ShuttlecockTypeId = 'plastic_nylon'
