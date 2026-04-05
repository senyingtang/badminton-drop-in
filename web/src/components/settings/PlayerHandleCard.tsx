'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from '@/app/(protected)/settings/settings.module.css'

const HANDLE_RE = /^[a-zA-Z0-9_]{3,30}$/

interface Props {
  userId: string
}

export default function PlayerHandleCard({ userId }: Props) {
  const supabase = createClient()
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [playerCode, setPlayerCode] = useState<string | null>(null)
  const [publicHandle, setPublicHandle] = useState('')
  const [lineBound, setLineBound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from('players')
      .select('id, player_code, public_handle, line_user_id')
      .eq('auth_user_id', userId)
      .maybeSingle()

    if (qErr) {
      setError(qErr.message)
      setLoading(false)
      return
    }
    if (!data) {
      setPlayerId(null)
      setLoading(false)
      return
    }
    setPlayerId(data.id)
    setPlayerCode(data.player_code ?? null)
    setPublicHandle(data.public_handle ? String(data.public_handle) : '')
    setLineBound(!!data.line_user_id)
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!playerId) return
    const trimmed = publicHandle.trim()
    const normalized = trimmed ? trimmed.toLowerCase() : ''
    if (normalized && !HANDLE_RE.test(normalized)) {
      setError('識別名須為 3–30 個英數字或底線（不可空白）')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const { error: upErr } = await supabase
        .from('players')
        .update({ public_handle: normalized || null })
        .eq('id', playerId)
      if (upErr) throw upErr
      setPublicHandle(normalized)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '儲存失敗'
      if (msg.includes('duplicate') || msg.includes('23505')) {
        setError('此識別名已被使用，請換一個')
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.cardDesc}>載入球員資料…</p>
      </div>
    )
  }

  if (!playerId) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>球員識別與 LINE</h2>
          <p className={styles.cardDesc}>
            您尚未有綁定帳號的球員資料。請先透過場次報名（登入狀態下報名）或由主辦將您加入名單，系統會建立球員紀錄後，即可在此設定公開識別名。
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <form onSubmit={handleSave} className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>球員識別名</h2>
          <p className={styles.cardDesc}>
            自訂英數與底線的公開識別名（3–30 字），日後可用於認領匿名報名紀錄或綁定 LINE
            等流程。與系統內部球員編號不同。
          </p>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>系統球員編號（player_code）</label>
          <input
            type="text"
            value={playerCode ?? ''}
            disabled
            className={styles.input}
          />
          <p className={styles.cardDesc} style={{ fontSize: '0.75rem', marginTop: '-4px' }}>
            內部唯一編號；若曾匿名報名，認領時可搭配此編號或您設定的識別名。
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="publicHandle" className={styles.label}>
            公開識別名（選填）
          </label>
          <input
            id="publicHandle"
            type="text"
            value={publicHandle}
            onChange={(e) => setPublicHandle(e.target.value)}
            placeholder="例如：badminton_king"
            className={styles.input}
            maxLength={30}
            autoComplete="username"
          />
          <p className={styles.cardDesc} style={{ fontSize: '0.75rem', marginTop: '-4px' }}>
            僅限英文字母、數字、底線；儲存時會轉成小寫。留空則清除識別名。
          </p>
        </div>

        {error && (
          <p style={{ color: '#f87171', fontSize: '0.875rem', marginBottom: '8px' }}>{error}</p>
        )}

        <div className={styles.actions}>
          {success && (
            <span className={styles.successMessage}>
              <span>✓</span> 已儲存
            </span>
          )}
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? '儲存中…' : '儲存識別名'}
          </button>
        </div>
      </form>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>綁定 LINE</h2>
          <p className={styles.cardDesc}>
            使用 LINE 登入綁定後，可用 LINE 快速登入並與您的球員資料關聯。請先在 LINE
            Developers 建立 <strong>LINE Login</strong> 通道，並將下列資訊提供給開發者設定：
          </p>
        </div>
        <ul
          style={{
            textAlign: 'left',
            margin: '0 0 16px',
            paddingLeft: '1.25rem',
            color: 'var(--text-secondary)',
            fontSize: '0.9rem',
            lineHeight: 1.6,
          }}
        >
          <li>LINE Login 的 <strong>Channel ID</strong>、<strong>Channel secret</strong></li>
          <li>
            Callback URL（範例）：<code>https://你的網域/api/auth/line/callback</code>（實際路徑依實作為準）
          </li>
          <li>（選用）<strong>LIFF ID</strong>：若要在 LINE 內開網頁綁定</li>
        </ul>
        <p className={styles.cardDesc} style={{ fontSize: '0.85rem', marginBottom: '12px' }}>
          <strong>LINE 官方帳號（@）</strong>僅在需要推播、聊天機器人、Messaging API
          時才要另外建立；單純「用 LINE 登入綁定」只需 LINE Login 通道即可。
        </p>
        {lineBound ? (
          <p className={styles.successMessage}>
            <span>✓</span> 已綁定 LINE
          </p>
        ) : (
          <button type="button" className={styles.btnSecondary} disabled>
            使用 LINE 綁定（待後端設定完成後啟用）
          </button>
        )}
      </div>
    </>
  )
}
