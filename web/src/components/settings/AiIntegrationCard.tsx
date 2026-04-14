'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from '@/app/(protected)/settings/settings.module.css'
import cardStyles from './AiIntegrationCard.module.css'

type AiStatus = {
  enabled: boolean
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

  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
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

  const envSnippet = [
    '# 以下皆可留空；留空表示不啟用 AI（應用程式不會呼叫外部 API）',
    `AI_API_BASE_URL=${baseUrl}`,
    `AI_API_KEY=${apiKey}`,
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
          只會使用您提供的 OpenAI 相容 API（Chat Completions）。所有欄位皆可留空；未設定完整 Base URL + API Key
          時，系統不會發出任何 AI 請求。
        </p>
      </div>

      <div className={cardStyles.statusBox}>
        <span className={cardStyles.statusLabel}>伺服端環境變數</span>
        {statusErr && <p className={cardStyles.warn}>{statusErr}</p>}
        {status && (
          <ul className={cardStyles.statusList}>
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
        <label className={styles.label} htmlFor="ai-base-url">
          AI_API_BASE_URL（根網址，勿含路徑尾端斜線亦可）
        </label>
        <input
          id="ai-base-url"
          className={styles.input}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder=""
          autoComplete="off"
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="ai-key">
          AI_API_KEY（僅用於產生範本；請勿將含真鑰的檔案提交 git）
        </label>
        <input
          id="ai-key"
          type="password"
          className={styles.input}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder=""
          autoComplete="off"
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
