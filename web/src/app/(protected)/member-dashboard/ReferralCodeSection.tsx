'use client'

import { useEffect, useState } from 'react'
import styles from './member-dashboard.module.css'

type Props = {
  referralCode: string
}

type Summary = {
  estimated_commission_cents: number
  effective_count: number
  adjustment_count: number
  voided_count: number
  message: string
}

function ntd(cents: number): string {
  const n = Number(cents) / 100
  if (Number.isNaN(n)) return 'NT$ 0'
  return `NT$ ${n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function ReferralCodeSection({ referralCode }: Props) {
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sum, setSum] = useState<Summary | null>(null)
  const [sumErr, setSumErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setSumErr(null)
      try {
        const res = await fetch('/api/member/commissions/summary')
        const j = (await res.json().catch(() => null)) as
          | { ok?: boolean; estimated_commission_cents?: number; effective_count?: number; adjustment_count?: number; voided_count?: number; message?: string; error?: string }
          | null
        if (!res.ok || !j?.ok) {
          setSumErr(j?.error || `HTTP ${res.status}`)
          setSum(null)
          return
        }
        setSum({
          estimated_commission_cents: Number(j.estimated_commission_cents || 0),
          effective_count: Number(j.effective_count || 0),
          adjustment_count: Number(j.adjustment_count || 0),
          voided_count: Number(j.voided_count || 0),
          message: j.message || '',
        })
      } catch {
        setSumErr('無法載入分潤摘要')
        setSum(null)
      }
    })()
  }, [])

  const handleCopy = async () => {
    setErr(null)
    try {
      await navigator.clipboard.writeText(referralCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr('無法複製，請手動選取代碼。')
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>您的推薦代碼</h2>
      <p className={styles.desc}>
        好友註冊時填入此代碼，未來符合分潤條件的消費將會列入您的預估分潤。
      </p>
      <div className={styles.codeBox}>{referralCode}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button type="button" className={styles.btn} onClick={() => void handleCopy()}>
          {copied ? '已複製' : '複製代碼'}
        </button>
      </div>
      {err && <p className={styles.warn}>{err}</p>}
      <div style={{ marginTop: 14 }}>
        {sumErr ? (
          <p className={styles.warn}>本月預估分潤：無法載入（{sumErr}）</p>
        ) : sum ? (
          <>
            <p className={styles.desc} style={{ marginBottom: 6 }}>
              本月預估分潤：<strong>{ntd(sum.estimated_commission_cents)}</strong>
            </p>
            <p className={styles.desc} style={{ marginBottom: 4, fontSize: '0.9rem' }}>
              本月有效分潤筆數：{sum.effective_count} · 調整筆數：{sum.adjustment_count} · 作廢筆數：{sum.voided_count}
            </p>
            <p className={styles.desc} style={{ fontSize: '0.82rem', color: 'var(--text-tertiary, #888)' }} title={sum.message}>
              {sum.message}
            </p>
          </>
        ) : (
          <p className={styles.desc}>本月預估分潤：載入中…</p>
        )}
      </div>
    </div>
  )
}
