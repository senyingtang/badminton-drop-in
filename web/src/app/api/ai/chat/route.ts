import { NextRequest, NextResponse } from 'next/server'
import { buildChatCompletionsUrl, getAiServerConfig } from '@/lib/ai/server-config'

export const runtime = 'nodejs'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * 代理呼叫您自訂的 OpenAI 相容 Chat Completions API。
 * 僅在環境變數 AI_API_BASE_URL + AI_API_KEY 皆有值時可用。
 */
export async function POST(req: NextRequest) {
  const cfg = getAiServerConfig()
  if (!cfg.enabled) {
    return NextResponse.json(
      {
        error: 'ai_not_configured',
        message: '未設定 AI：請於伺服端設定 AI_API_BASE_URL 與 AI_API_KEY（其餘欄位皆選填）。',
      },
      { status: 503 }
    )
  }

  let body: {
    messages?: ChatMessage[]
    model?: string
    temperature?: number
    max_tokens?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages_required' }, { status: 400 })
  }

  const model =
    (typeof body.model === 'string' && body.model.trim()) || cfg.model || ''
  if (!model) {
    return NextResponse.json(
      {
        error: 'model_required',
        message: '請設定環境變數 AI_MODEL，或在請求 body 傳入 model。',
      },
      { status: 400 }
    )
  }

  const url = buildChatCompletionsUrl(cfg)
  if (!url) {
    return NextResponse.json({ error: 'invalid_base_url' }, { status: 500 })
  }

  const outbound: ChatMessage[] = []
  if (cfg.systemPromptDefault) {
    outbound.push({ role: 'system', content: cfg.systemPromptDefault })
  }
  outbound.push(...messages)

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), cfg.timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: outbound,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.3,
        ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
      }),
      signal: controller.signal,
    })

    const text = await res.text()
    const ct = res.headers.get('content-type') || 'application/json'
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': ct } })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return NextResponse.json(
      { error: aborted ? 'ai_timeout' : 'ai_fetch_failed', message: aborted ? '請求逾時' : '無法連線至 AI API' },
      { status: 502 }
    )
  } finally {
    clearTimeout(t)
  }
}
