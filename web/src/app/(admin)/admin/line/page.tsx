'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from '../users/users.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export default function AdminLineIntegrationPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [messagingChannelId, setMessagingChannelId] = useState('')
  const [messagingChannelSecret, setMessagingChannelSecret] = useState('')
  const [messagingAccessToken, setMessagingAccessToken] = useState('')
  const [loginChannelId, setLoginChannelId] = useState('')
  const [loginChannelSecret, setLoginChannelSecret] = useState('')
  const [oaAddFriendUrl, setOaAddFriendUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    const { data, error } = await supabase.from('platform_line_integration').select('*').eq('id', 1).maybeSingle()
    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        setMsg({
          type: 'err',
          text: '資料表尚未建立：請在 Supabase 執行 docs/039_platform_line_integration.sql',
        })
      } else {
        setMsg({ type: 'err', text: error.message })
      }
      setLoading(false)
      return
    }
    const r = data as Row | null
    if (r) {
      setMessagingChannelId(String(r.messaging_channel_id || ''))
      setMessagingChannelSecret(String(r.messaging_channel_secret || ''))
      setMessagingAccessToken(String(r.messaging_channel_access_token || ''))
      setLoginChannelId(String(r.login_channel_id || ''))
      setLoginChannelSecret(String(r.login_channel_secret || ''))
      setOaAddFriendUrl(String(r.oa_add_friend_url || ''))
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('platform_line_integration').upsert(
      {
        id: 1,
        messaging_channel_id: messagingChannelId.trim() || null,
        messaging_channel_secret: messagingChannelSecret.trim() || null,
        messaging_channel_access_token: messagingAccessToken.trim() || null,
        login_channel_id: loginChannelId.trim() || null,
        login_channel_secret: loginChannelSecret.trim() || null,
        oa_add_friend_url: oaAddFriendUrl.trim() || null,
      },
      { onConflict: 'id' }
    )
    setSaving(false)
    if (error) {
      setMsg({ type: 'err', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: '已儲存。請確認 Vercel 已設定 SUPABASE_SERVICE_ROLE_KEY 以便推播 API 讀取權杖。' })
    await load()
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入中…</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 8 }}>LINE 整合（平台專用）</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 24, lineHeight: 1.6 }}>
        此頁僅限具備<strong>平台管理員</strong>身分者可進入；資料表亦僅允許平台管理員讀寫。
        各場<strong>團主／主辦</strong>無法在此填寫或變更 LINE 憑證，推播與登入通道皆由您（開發者）在此維護即可。
      </p>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 24, lineHeight: 1.6 }}>
        請設定 <strong>LINE Messaging API</strong>（候補晉升正選推播）與 <strong>LINE Login</strong>。
        推播對象為球員之 <code>line_user_id</code>；球友須已將官方帳號加為好友，推播才會送達。
      </p>

      {msg && (
        <p
          style={{
            marginBottom: 16,
            color: msg.type === 'ok' ? '#86efac' : '#fca5a5',
            fontSize: 'var(--text-sm)',
          }}
        >
          {msg.text}
        </p>
      )}

      <form
        onSubmit={(e) => void handleSave(e)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          background: 'var(--bg-glass)',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Messaging API（推播）</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Channel ID</span>
          <input className="input" value={messagingChannelId} onChange={(e) => setMessagingChannelId(e.target.value)} autoComplete="off" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Channel secret（選填，備註用）</span>
          <input
            type="password"
            className="input"
            value={messagingChannelSecret}
            onChange={(e) => setMessagingChannelSecret(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Channel access token（長效）</span>
          <input
            type="password"
            className="input"
            value={messagingAccessToken}
            onChange={(e) => setMessagingAccessToken(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginTop: 8 }}>LINE Login</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Channel ID</span>
          <input className="input" value={loginChannelId} onChange={(e) => setLoginChannelId(e.target.value)} autoComplete="off" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Channel secret</span>
          <input
            type="password"
            className="input"
            value={loginChannelSecret}
            onChange={(e) => setLoginChannelSecret(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginTop: 8 }}>LINE@（加好友導流）</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>加好友連結（lin.ee）</span>
          <input
            className="input"
            value={oaAddFriendUrl}
            onChange={(e) => setOaAddFriendUrl(e.target.value)}
            placeholder="https://lin.ee/xxxxxx"
            autoComplete="off"
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            用於公開報名頁 <code>/s/[code]</code> 的 Pop-up 提示（加入 LINE@ 才能收到名單異動通知）。此欄位可對外公開。
          </span>
        </label>

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
      </form>
    </div>
  )
}
