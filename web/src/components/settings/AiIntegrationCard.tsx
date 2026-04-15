'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from '@/app/(protected)/settings/settings.module.css'
import cardStyles from './AiIntegrationCard.module.css'

type AiStatus = {
  enabled: boolean
  provider?: string | null
  baseUrlSet: boolean
  keySet: boolean
  modelSet: boolean
  completionsPath: string
  systemPromptSet: boolean
  timeoutMs: number
}

/** 表單僅供產生 .env.local 範本；不寫入伺服器。金鑰請只放在部署環境變數。 */
export default function AiIntegrationCard() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)

  const [provider, setProvider] = useState<'custom' | 'openai' | 'openrouter' | 'deepseek' | 'groq' | 'mistral' | 'ollama'>('custom')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [providerKey, setProviderKey] = useState('')
  const [model, setModel] = useState('')
  const [path, setPath] = useState('/v1/chat/completions')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('')

  const loadStatus = useCallback(async () => {
    setStatusErr(null)
    try {
      const res = await fetch('/api/ai/status')
      if (!res.ok) throw new Error(await res.text())
      setStatus((await res.json()) as AiStatus)
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : '無法讀取狀態')
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const providerKeyLine = (() => {
    if (provider === 'custom') return `AI_API_KEY=${apiKey}`
    if (provider === 'openai') return `AI_OPENAI_API_KEY=${providerKey}`
    if (provider === 'openrouter') return `AI_OPENROUTER_API_KEY=${providerKey}`
    if (provider === 'deepseek') return `AI_DEEPSEEK_API_KEY=${providerKey}`
    if (provider === 'groq') return `AI_GROQ_API_KEY=${providerKey}`
    if (provider === 'mistral') return `AI_MISTRAL_API_KEY=${providerKey}`
    if (provider === 'ollama') return `AI_OLLAMA_BASE_URL=${baseUrl || 'http://localhost:11434'}`
    return `AI_API_KEY=${apiKey}`
  })()

  const envSnippet = [
    '# 以下皆可留空；留空表示不啟用 AI（應用程式不會呼叫外部 API）',
    `AI_PROVIDER=${provider === 'custom' ? '' : provider}`,
    `AI_API_BASE_URL=${provider === 'custom' ? baseUrl : ''}`,
    providerKeyLine,
    `AI_MODEL=${model}`,
    `AI_CHAT_COMPLETIONS_PATH=${path || '/v1/chat/completions'}`,
    systemPrompt
      ? `AI_SYSTEM_PROMPT_DEFAULT=${JSON.stringify(systemPrompt)}`
      : 'AI_SYSTEM_PROMPT_DEFAULT=',
    timeoutMs.trim()
      ? `AI_TIMEOUT_MS=${timeoutMs.trim()}`
      : 'AI_TIMEOUT_MS=',
    '',
  ].join('\n')

  const copySnippet = async () => {
    await navigator.clipboard.writeText(envSnippet)
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>AI 整合（選填）</h2>
        <p className={styles.cardDesc}>
          目前僅支援「OpenAI 相容 Chat Completions」端點（包含 OpenAI / OpenRouter / DeepSeek / Groq / Mistral / Ollama 等相容服務）。
          所有欄位皆可留空；未設定可用的 Base URL + API Key 時，系統不會發出任何 AI 請求。
        </p>
      </div>

      <div className={cardStyles.statusBox}>
        <span className={cardStyles.statusLabel}>伺服端環境變數</span>
        {statusErr && <p className={cardStyles.warn}>{statusErr}</p>}
        {status && (
          <ul className={cardStyles.statusList}>
            <li>Provider：<code>{status.provider || '(未設定)'}</code></li>
            <li>Base URL：{status.baseUrlSet ? '已設定' : '未設定'}</li>
            <li>API Key：{status.keySet ? '已設定' : '未設定'}</li>
            <li>Model：{status.modelSet ? '已設定' : '未設定'}</li>
            <li>路徑：<code>{status.completionsPath}</code></li>
            <li>預設系統提示：{status.systemPromptSet ? '已設定' : '未設定'}</li>
            <li>逾時：{status.timeoutMs} ms</li>
            <li>
              <strong>{status.enabled ? 'AI 代理已可從後端呼叫' : 'AI 代理未啟用（可全部留空）'}</strong>
            </li>
          </ul>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadStatus()}>
          重新整理狀態
        </button>
      </div>

      <p className={cardStyles.note}>
        下列表單<strong>不會儲存</strong>到資料庫，僅供您在本機產生
        <code>.env.local</code> 範本後自行貼上金鑰與網址。正式環境請在主機設定相同名稱的環境變數。
      </p>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-provider">
          AI_PROVIDER（選填：使用預設服務；若選 custom 則使用 AI_API_BASE_URL + AI_API_KEY）
        </label>
        <select
          id="ai-provider"
          className={styles.input}
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
        >
          <option value="custom">custom（自行填 Base URL）</option>
          <option value="openai">openai</option>
          <option value="openrouter">openrouter</option>
          <option value="deepseek">deepseek</option>
          <option value="groq">groq</option>
          <option value="mistral">mistral</option>
          <option value="ollama">ollama（本機）</option>
        </select>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-base-url">
          {provider === 'ollama'
            ? 'AI_OLLAMA_BASE_URL（選填，預設 http://localhost:11434）'
            : 'AI_API_BASE_URL（根網址，勿含路徑尾端斜線亦可；僅 custom 需要）'}
        </label>
        <input
          id="ai-base-url"
          className={styles.input}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder=""
          autoComplete="off"
          disabled={provider !== 'custom' && provider !== 'ollama'}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-key">
          {provider === 'custom'
            ? 'AI_API_KEY（僅用於產生範本；請勿將含真鑰的檔案提交 git）'
            : provider === 'openai'
              ? 'AI_OPENAI_API_KEY'
              : provider === 'openrouter'
                ? 'AI_OPENROUTER_API_KEY'
                : provider === 'deepseek'
                  ? 'AI_DEEPSEEK_API_KEY'
                  : provider === 'groq'
                    ? 'AI_GROQ_API_KEY'
                    : provider === 'mistral'
                      ? 'AI_MISTRAL_API_KEY'
                      : '（Ollama 不需要 API Key）'}
        </label>
        <input
          id="ai-key"
          type="password"
          className={styles.input}
          value={provider === 'custom' ? apiKey : providerKey}
          onChange={(e) => (provider === 'custom' ? setApiKey(e.target.value) : setProviderKey(e.target.value))}
          placeholder=""
          autoComplete="off"
          disabled={provider === 'ollama'}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-model">
          AI_MODEL（可留空，改由呼叫 /api/ai/chat 時傳 body.model）
        </label>
        <input
          id="ai-model"
          className={styles.input}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder=""
          autoComplete="off"
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-path">
          AI_CHAT_COMPLETIONS_PATH
        </label>
        <input
          id="ai-path"
          className={styles.input}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/v1/chat/completions"
          autoComplete="off"
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-sys">
          AI_SYSTEM_PROMPT_DEFAULT（可留空）
        </label>
        <textarea
          id="ai-sys"
          className={cardStyles.textarea}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder=""
          rows={3}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-to">
          AI_TIMEOUT_MS（可留空，預設 30000）
        </label>
        <input
          id="ai-to"
          className={styles.input}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          placeholder=""
          inputMode="numeric"
          autoComplete="off"
        />
      </div>

      <div className={cardStyles.actions}>
        <button type="button" className="btn btn-primary" onClick={() => void copySnippet()}>
          複製 .env.local 範本
        </button>
      </div>

      <pre className={cardStyles.pre} tabIndex={0}>
        {envSnippet}
      </pre>

      <p className={cardStyles.note}>
        後端路由：<code>/api/ai/status</code>（GET）、<code>/api/ai/chat</code>（POST，需已設定 Base URL + Key）。
        僅使用環境變數中的端點與金鑰，不會改用其他第三方預設服務。
      </p>
    </div>
  )
}
