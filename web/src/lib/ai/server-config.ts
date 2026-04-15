/**
 * 伺服端 AI 設定：僅讀取環境變數，未設定時一律視為「未啟用」、不呼叫任何外部 API。
 * 所有欄位皆可留空。
 */

export type AiServerConfig = {
  enabled: boolean
  /** 選填：使用哪個預設供應商（僅影響 baseUrl/key 的 fallback 推導） */
  provider: string | null
  baseUrl: string | null
  apiKey: string | null
  model: string | null
  /** OpenAI 相容 chat completions 路徑，預設 /v1/chat/completions */
  completionsPath: string
  /** 選填：預設系統提示（可留空） */
  systemPromptDefault: string | null
  /** 選填：請求逾時毫秒 */
  timeoutMs: number
}

function trimOrNull(v: string | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

function normalizeProvider(v: string | null): string | null {
  const p = (v || '').trim().toLowerCase()
  return p ? p : null
}

function providerDefaults(provider: string | null): { baseUrl: string | null; apiKey: string | null } {
  switch (provider) {
    case 'openai':
      return { baseUrl: 'https://api.openai.com', apiKey: trimOrNull(process.env.AI_OPENAI_API_KEY) }
    case 'openrouter':
      return { baseUrl: 'https://openrouter.ai/api', apiKey: trimOrNull(process.env.AI_OPENROUTER_API_KEY) }
    case 'deepseek':
      return { baseUrl: 'https://api.deepseek.com', apiKey: trimOrNull(process.env.AI_DEEPSEEK_API_KEY) }
    case 'groq':
      // Groq 提供 OpenAI 相容端點
      return { baseUrl: 'https://api.groq.com/openai', apiKey: trimOrNull(process.env.AI_GROQ_API_KEY) }
    case 'mistral':
      // Mistral 提供 OpenAI 相容端點
      return { baseUrl: 'https://api.mistral.ai', apiKey: trimOrNull(process.env.AI_MISTRAL_API_KEY) }
    case 'ollama':
      // Ollama 可能不需要 key；允許自訂 base url（預設 localhost）
      return { baseUrl: trimOrNull(process.env.AI_OLLAMA_BASE_URL) ?? 'http://localhost:11434', apiKey: null }
    default:
      return { baseUrl: null, apiKey: null }
  }
}

export function getAiServerConfig(): AiServerConfig {
  const provider = normalizeProvider(trimOrNull(process.env.AI_PROVIDER))

  const baseUrl = trimOrNull(process.env.AI_API_BASE_URL)
  const apiKey = trimOrNull(process.env.AI_API_KEY)
  const model = trimOrNull(process.env.AI_MODEL)
  const completionsPath =
    trimOrNull(process.env.AI_CHAT_COMPLETIONS_PATH) ?? '/v1/chat/completions'
  const systemPromptDefault = trimOrNull(process.env.AI_SYSTEM_PROMPT_DEFAULT)
  const timeoutRaw = process.env.AI_TIMEOUT_MS?.trim()
  const timeoutMs = timeoutRaw ? Math.min(Math.max(parseInt(timeoutRaw, 10) || 30000, 5000), 120000) : 30000

  const defaults = providerDefaults(provider)
  const resolvedBaseUrl = baseUrl ?? defaults.baseUrl
  const resolvedApiKey = apiKey ?? defaults.apiKey

  const enabled = !!(resolvedBaseUrl && resolvedApiKey)

  return {
    enabled,
    provider,
    baseUrl: resolvedBaseUrl,
    apiKey: resolvedApiKey,
    model,
    completionsPath: completionsPath.startsWith('/') ? completionsPath : `/${completionsPath}`,
    systemPromptDefault,
    timeoutMs,
  }
}

export function buildChatCompletionsUrl(cfg: Pick<AiServerConfig, 'baseUrl' | 'completionsPath'>): string | null {
  if (!cfg.baseUrl) return null
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const path = cfg.completionsPath.startsWith('/') ? cfg.completionsPath : `/${cfg.completionsPath}`
  return `${base}${path}`
}
