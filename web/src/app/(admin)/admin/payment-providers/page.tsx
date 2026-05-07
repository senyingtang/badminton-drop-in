'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from '../admin.module.css'

type Provider = 'manual' | 'ecpay' | 'newebpay' | 'stripe' | 'other'
type Env = 'sandbox' | 'production'

type Row = {
  id: string
  provider: Provider
  display_name: string
  environment: Env
  is_enabled: boolean
  is_subscription_enabled: boolean
  is_wallet_topup_enabled: boolean
  merchant_id: string | null
  api_base_url: string | null
  return_url: string | null
  notify_url: string | null
  subscription_notify_url: string | null
}

export default function AdminPaymentProvidersPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const emptyDraft = useMemo<Row>(
    () => ({
      id: 'new',
      provider: 'manual',
      display_name: 'Manual',
      environment: 'sandbox',
      is_enabled: false,
      is_subscription_enabled: false,
      is_wallet_topup_enabled: false,
      merchant_id: null,
      api_base_url: null,
      return_url: null,
      notify_url: null,
      subscription_notify_url: null,
    }),
    []
  )

  useEffect(() => {
    void (async () => {
      setErr(null)
      const { data, error } = await supabase
        .from('kb_payment_provider_configs')
        .select(
          'id, provider, display_name, environment, is_enabled, is_subscription_enabled, is_wallet_topup_enabled, merchant_id, api_base_url, return_url, notify_url, subscription_notify_url'
        )
        .order('provider', { ascending: true })
        .order('environment', { ascending: true })
      if (error) {
        setErr(error.message)
        setRows([emptyDraft])
        setLoading(false)
        return
      }
      setRows([...(data as Row[]), emptyDraft])
      setLoading(false)
    })()
  }, [emptyDraft, supabase])

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const save = async (r: Row) => {
    setSavingId(r.id)
    setErr(null)
    try {
      const base = {
        provider: r.provider,
        display_name: r.display_name,
        environment: r.environment,
        is_enabled: r.is_enabled,
        is_subscription_enabled: r.is_subscription_enabled,
        is_wallet_topup_enabled: r.is_wallet_topup_enabled,
        merchant_id: r.merchant_id,
        api_base_url: r.api_base_url,
        return_url: r.return_url,
        notify_url: r.notify_url,
        subscription_notify_url: r.subscription_notify_url,
        // NOTE: secrets (hash_key_encrypted/hash_iv_encrypted/webhook_secret_encrypted) are intentionally not readable here.
      }

      if (r.id === 'new') {
        const { error } = await supabase.from('kb_payment_provider_configs').insert(base)
        if (error) throw error
      } else {
        const { error } = await supabase.from('kb_payment_provider_configs').update(base).eq('id', r.id)
        if (error) throw error
      }

      alert('已儲存（密鑰欄位需用 server-side 工具寫入，避免前端回顯）。')
      window.location.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>金流設定</h1>
      <p className={styles.subtitle}>僅平台管理員可設定。密鑰不會在前端回顯明文。</p>

      {err && <div className={styles.error}>錯誤：{err}</div>}

      {loading ? (
        <div className={styles.loading}>載入中…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((r) => (
            <section key={r.id} className={styles.card}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="input"
                  value={r.provider}
                  onChange={(e) => updateRow(r.id, { provider: e.target.value as Provider })}
                  disabled={r.id !== 'new'}
                >
                  <option value="manual">manual</option>
                  <option value="ecpay">ecpay</option>
                  <option value="newebpay">newebpay</option>
                  <option value="stripe">stripe</option>
                  <option value="other">other</option>
                </select>

                <select
                  className="input"
                  value={r.environment}
                  onChange={(e) => updateRow(r.id, { environment: e.target.value as Env })}
                  disabled={r.id !== 'new'}
                >
                  <option value="sandbox">sandbox</option>
                  <option value="production">production</option>
                </select>

                <input
                  className="input"
                  value={r.display_name}
                  onChange={(e) => updateRow(r.id, { display_name: e.target.value })}
                  placeholder="Display name"
                />

                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={r.is_enabled}
                    onChange={(e) => updateRow(r.id, { is_enabled: e.target.checked })}
                  />
                  啟用
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={r.is_wallet_topup_enabled}
                    onChange={(e) => updateRow(r.id, { is_wallet_topup_enabled: e.target.checked })}
                  />
                  啟用錢包儲值
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={r.is_subscription_enabled}
                    onChange={(e) => updateRow(r.id, { is_subscription_enabled: e.target.checked })}
                  />
                  啟用訂閱
                </label>
              </div>

              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <input
                  className="input"
                  value={r.merchant_id || ''}
                  onChange={(e) => updateRow(r.id, { merchant_id: e.target.value || null })}
                  placeholder="Merchant ID"
                />
                <input
                  className="input"
                  value={r.api_base_url || ''}
                  onChange={(e) => updateRow(r.id, { api_base_url: e.target.value || null })}
                  placeholder="API Base URL"
                />
                <input
                  className="input"
                  value={r.return_url || ''}
                  onChange={(e) => updateRow(r.id, { return_url: e.target.value || null })}
                  placeholder="Return URL"
                />
                <input
                  className="input"
                  value={r.notify_url || ''}
                  onChange={(e) => updateRow(r.id, { notify_url: e.target.value || null })}
                  placeholder="Notify URL"
                />
                <input
                  className="input"
                  value={r.subscription_notify_url || ''}
                  onChange={(e) => updateRow(r.id, { subscription_notify_url: e.target.value || null })}
                  placeholder="Subscription Notify URL"
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => alert('TODO：將來改成 server-side ping provider endpoint。')}
                >
                  測試連線
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingId === r.id}
                  onClick={() => void save(r)}
                >
                  {savingId === r.id ? '儲存中…' : '儲存設定'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

