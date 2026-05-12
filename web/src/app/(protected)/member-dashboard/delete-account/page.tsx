'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from './delete-account.module.css'

export default function DeleteAccountPage() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (text.trim() !== 'DELETE') {
      setErr('請輸入大寫 DELETE 以確認')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/member/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationText: 'DELETE' }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !j?.ok) {
        setErr(j?.message || `刪除失敗（HTTP ${res.status}）`)
        return
      }
      const supabase = createClient()
      await supabase.auth.signOut()
      window.location.href = '/?accountDeleted=1'
    } catch (e) {
      setErr(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>刪除帳號</h1>
        <p className={styles.lead}>
          刪除帳號後，您將無法再使用此帳號登入。既有場次、付款、分潤、訂閱等歷史紀錄會保留於系統稽核用途，後台將顯示為「此會員已刪除帳號」。
        </p>
        <p className={styles.warn}>此操作無法由您自行復原；若需保留帳號請返回會員中心。</p>
        <label className={styles.label} htmlFor="del-confirm">
          請輸入 <strong>DELETE</strong> 以確認
        </label>
        <input
          id="del-confirm"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          placeholder="DELETE"
        />
        {err ? <p className={styles.error}>{err}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.danger} disabled={loading} onClick={() => void submit()}>
            {loading ? '處理中…' : '確認刪除帳號'}
          </button>
          <Link href="/member-dashboard" className={styles.back}>
            返回會員中心
          </Link>
        </div>
      </div>
    </div>
  )
}
