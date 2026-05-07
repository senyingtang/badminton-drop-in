'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styles from '../member-dashboard.module.css'

type ApiGetRes =
  | { ok: true; bound: true; lineOaUserId: string; line_oa_add_friend_url: string }
  | { ok: true; bound: false; code: string | null; expires_at: string | null; line_oa_add_friend_url: string }
  | { ok: false; error: string }

type ApiPostRes =
  | { ok: true; bound: true; lineOaUserId: string; line_oa_add_friend_url: string }
  | { ok: true; bound: false; code: string; expires_at: string; line_oa_add_friend_url: string; instructions?: any }
  | { ok: false; error: string }

function humanizeError(err: string): string {
  const e = String(err || '').toUpperCase()
  if (e.includes('UNAUTHENTICATED')) return '尚未登入，請重新登入。'
  if (e.includes('PROFILE_NOT_FOUND')) return '找不到會員資料，請先完成會員資料建立。'
  if (e.includes('LINE_OA_NOT_CONFIGURED')) return 'LINE OA 尚未設定，請聯繫管理員。'
  if (e.includes('SERVICE_ROLE_NOT_CONFIGURED')) return '伺服端尚未設定 Service Role，請聯繫管理員。'
  if (e.includes('CREATE_BINDING_CODE_FAILED')) return '綁定碼產生失敗，請稍後再試。'
  return `綁定碼處理失敗：${err}`
}

export default function LineBindingPage() {
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [data, setData] = useState<ApiGetRes | null>(null)
  const [error, setError] = useState<string>('')

  const fetchState = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/member/line-binding-code', { method: 'GET' })
      const j = (await res.json().catch(() => null)) as ApiGetRes | null
      if (!res.ok || !j?.ok) {
        setError(humanizeError((j as any)?.error || `HTTP ${res.status}`))
        setData(j)
        return
      }
      setData(j)
    } catch {
      setError('無法取得綁定資訊，請稍後再試。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchState()
  }, [fetchState])

  const bound = Boolean((data as any)?.ok && (data as any)?.bound)
  const code = !bound && (data as any)?.ok ? ((data as any)?.code as string | null) : null
  const expiresAt = !bound && (data as any)?.ok ? ((data as any)?.expires_at as string | null) : null
  const addFriendUrl = (data as any)?.ok ? String((data as any)?.line_oa_add_friend_url || '') : ''

  const command = useMemo(() => (code ? `綁定 ${code}` : ''), [code])

  const handleGenerate = useCallback(async () => {
    setMutating(true)
    setError('')
    try {
      const res = await fetch('/api/member/line-binding-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const j = (await res.json().catch(() => null)) as ApiPostRes | null
      if (!res.ok || !j?.ok) {
        setError(humanizeError((j as any)?.error || `HTTP ${res.status}`))
        return
      }
      await fetchState()
    } catch {
      setError('綁定碼產生失敗，請稍後再試。')
    } finally {
      setMutating(false)
    }
  }, [fetchState])

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert('已複製')
    } catch {
      alert('複製失敗，請手動複製')
    }
  }, [])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>LINE@ 通知綁定</h1>
        <p className={styles.subtitle}>
          綁定後，當您報名的臨打名單、候補遞補、開打提醒或場次異動時，系統可以透過 LINE@ 通知您。
        </p>
      </header>

      <div className={styles.card}>
        {loading ? (
          <p className={styles.desc}>載入中…</p>
        ) : bound ? (
          <>
            <p className={styles.ok}>已完成 LINE@ 通知綁定。</p>
            <p className={styles.desc}>您將可收到候補遞補、名單異動與開打提醒。</p>
          </>
        ) : (
          <>
            <div className={styles.stepsGrid}>
              <div className={styles.stepItem}>
                <div className={styles.stepTitle}>1. 加入 LINE@ 官方帳號</div>
                <div className={styles.desc}>請先加入「羽球排組平台」LINE@ 官方帳號。</div>
              </div>
              <div className={styles.stepItem}>
                <div className={styles.stepTitle}>2. 點擊「產生綁定代碼」</div>
                <div className={styles.desc}>系統會產生一組一次性綁定碼，效期為 10 分鐘。</div>
              </div>
              <div className={styles.stepItem}>
                <div className={styles.stepTitle}>3. 回到 LINE@ 聊天室輸入綁定碼</div>
                <div className={styles.desc}>
                  請輸入：<code>綁定 ABC123</code>（其中 ABC123 請替換為畫面上顯示的綁定碼）
                </div>
              </div>
              <div className={styles.stepItem}>
                <div className={styles.stepTitle}>4. 綁定成功</div>
                <div className={styles.desc}>綁定成功後，您之後就能收到候補遞補、名單異動與開打提醒。</div>
              </div>
            </div>

            <div className={styles.desc} style={{ marginTop: 10 }}>
              注意事項：
              <ul className={styles.bullets}>
                <li>綁定碼僅限本人使用。</li>
                <li>綁定碼逾期後可重新產生。</li>
                <li>若 LINE@ 沒有回應，請確認您已加入官方帳號。</li>
                <li>LINE Login 與 LINE@ 通知綁定是不同功能，登入成功不代表已完成 LINE@ 通知綁定。</li>
              </ul>
            </div>

            {error && <p className={styles.warn}>{error}</p>}

            {code ? (
              <>
                <div className={styles.codeBox} style={{ marginTop: 10 }}>
                  {command}
                </div>
                {expiresAt && (
                  <p className={styles.desc}>
                    綁定碼效期至：{new Date(expiresAt).toLocaleString('zh-TW')}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.desc}>尚未產生綁定碼。</p>
            )}

            <div className={styles.actionRow}>
              <button className={styles.btn} type="button" onClick={() => void handleGenerate()} disabled={mutating}>
                {mutating ? '產生中…' : code ? '重新產生' : '產生綁定代碼'}
              </button>
              <button className={styles.ghostBtn} type="button" onClick={() => command && void handleCopy(command)} disabled={!command}>
                複製綁定指令
              </button>
              <a className={styles.ghostBtn} href={addFriendUrl || '#'} target="_blank" rel="noreferrer">
                前往 LINE@
              </a>
              <Link className={styles.link} href="/member-dashboard">
                回會員中心
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

