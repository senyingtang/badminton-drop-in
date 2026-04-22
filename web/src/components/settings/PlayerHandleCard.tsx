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
  const [lineLoading, setLineLoading] = useState(false)

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
            LINE Login 與 Messaging 憑證僅在<strong>平台管理後台</strong>由管理員設定；場次團主與一般使用者無法填寫。
            啟用後，您可在此將個人 LINE 與球員資料綁定，以便快速登入與接收推播（若平台已開啟）。
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
          <li>無須自行到 LINE Developers 建立通道；由平台管理員於後台完成即可。</li>
          <li>推播相關請將官方帳號加為好友（管理員於後台設定 Messaging API 後始會生效）。</li>
        </ul>
        <p className={styles.cardDesc} style={{ fontSize: '0.85rem', marginBottom: '12px' }}>
          若此處按鈕仍為停用，代表 LINE 綁定流程尚未接上或後台尚未完成設定，請洽平台管理員。
        </p>
        {lineBound ? (
          <p className={styles.successMessage}>
            <span>✓</span> 已綁定 LINE
          </p>
        ) : (
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={lineLoading}
            onClick={() => {
              setLineLoading(true)
              setError(null)
              try {
                window.location.href = `/api/auth/line/start?returnTo=${encodeURIComponent('/settings')}`
              } catch (e) {
                setError(e instanceof Error ? e.message : '跳轉失敗')
                setLineLoading(false)
              }
            }}
          >
            {lineLoading ? '跳轉至 LINE…' : '使用 LINE 登入並綁定'}
          </button>
        )}
      </div>
    </>
  )
}
