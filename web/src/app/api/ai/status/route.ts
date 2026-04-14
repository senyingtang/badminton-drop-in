import { NextResponse } from 'next/server'
import { getAiServerConfig } from '@/lib/ai/server-config'

/** 回傳是否已設定（不洩漏金鑰或完整 URL 內容） */
export async function GET() {
  const cfg = getAiServerConfig()
  return NextResponse.json({
    enabled: cfg.enabled,
    baseUrlSet: !!cfg.baseUrl,
    keySet: !!cfg.apiKey,
    modelSet: !!cfg.model,
    completionsPath: cfg.completionsPath,
    systemPromptSet: !!cfg.systemPromptDefault,
    timeoutMs: cfg.timeoutMs,
  })
}
