'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { sanitizeLiffEntryReturnTo } from '@/lib/safeInternalReturnPath'
import { postPublicSignupErrorFromClient } from '@/lib/publicSignupErrorLog'
import styles from './liff-entry.module.css'

const STORAGE_RETURN = 'kb_liff_line_return_to'
const STORAGE_REF = 'kb_liff_line_ref'

function liffAttemptKey(returnTo: string): string {
  return `kb_liff_login_attempts:${returnTo}`
}

function buildLiffLaunchUrl(safeReturnTo: string, ref: string): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_LINE_LIFF_URL?.trim()
  const id = process.env.NEXT_PUBLIC_LINE_LIFF_ID?.trim()
  let launch = ''
  if (baseUrl) launch = baseUrl
  else if (id) launch = `https://liff.line.me/${id}`
  else return null
  try {
    const u = new URL(launch.startsWith('http') ? launch : `https://liff.line.me/${id}`)
    u.searchParams.set('returnTo', safeReturnTo)
    const r = ref.trim()
    if (r) u.searchParams.set('ref', r)
    return u.toString()
  } catch {
    return null
  }
}

function lineStartUrl(safeReturnTo: string, ref: string): string {
  const u = new URL('/api/auth/line/start', typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  u.searchParams.set('returnTo', safeReturnTo)
  const r = ref.trim()
  if (r) u.searchParams.set('referralCode', r)
  return u.pathname + u.search
}

export default function LiffEntryClient() {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'pending' | 'web-fallback' | 'loop-blocked'>('pending')
  const ranOnce = useRef(false)

  const { safeReturnTo, ref } = useMemo(() => {
    const raw = searchParams.get('returnTo')
    const refRaw = searchParams.get('ref') || ''
    return { safeReturnTo: sanitizeLiffEntryReturnTo(raw), ref: refRaw }
  }, [searchParams])

  useLayoutEffect(() => {
    if (ranOnce.current) return
    ranOnce.current = true

    const liffUrl = buildLiffLaunchUrl(safeReturnTo, ref)
    if (!liffUrl) {
      setMode('web-fallback')
      return
    }

    const key = liffAttemptKey(safeReturnTo)
    let n = 0
    try {
      n = parseInt(sessionStorage.getItem(key) || '0', 10) || 0
    } catch {
      n = 0
    }
    n += 1
    try {
      sessionStorage.setItem(key, String(n))
    } catch {
      // ignore
    }
    if (n > 2) {
      void postPublicSignupErrorFromClient({
        share_signup_code: null,
        session_id: null,
        flow: 'liff_entry',
        error_code: 'LIFF_LOGIN_LOOP_DETECTED',
        error_message: `liff redirect attempts=${n}`,
        payload_snapshot: { returnTo: safeReturnTo, ref: ref.trim() || null },
      })
      setMode('loop-blocked')
      return
    }

    try {
      sessionStorage.setItem(STORAGE_RETURN, safeReturnTo)
      if (ref.trim()) sessionStorage.setItem(STORAGE_REF, ref.trim())
    } catch {
      // ignore
    }
    window.location.replace(liffUrl)
  }, [safeReturnTo, ref])

  if (mode === 'loop-blocked') {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>LINE 登入異常</h1>
        <p className={styles.errorText}>
          LINE 登入重複跳轉，請改用 LINE App 開啟或重新整理後再試。
        </p>
        <p className={styles.mono}>錯誤代碼：LIFF_LOGIN_LOOP_DETECTED</p>
        <div className={styles.actions}>
          <a className={styles.primary} href={lineStartUrl(safeReturnTo, ref)}>
            改用 Web LINE Login
          </a>
          <Link className={styles.secondary} href={safeReturnTo}>
            返回報名頁
          </Link>
        </div>
      </div>
    )
  }

  if (mode === 'pending') {
    return (
      <div className={styles.wrap}>
        <p className={styles.muted}>正在開啟 LINE…</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>LINE 快速報名</h1>
      <p className={styles.body}>
        目前站方尚未設定 LIFF，將使用 <strong>Web LINE Login</strong>。若接下來出現 LINE 官方的 Email／密碼登入畫面，建議改用
        <strong> LINE App 掃描 QR Code</strong> 或在外部瀏覽器改用手機已登入的 LINE 開啟本連結，以提升成功率。
      </p>
      <div className={styles.actions}>
        <a className={styles.primary} href={lineStartUrl(safeReturnTo, ref)}>
          繼續使用 Web LINE Login
        </a>
        <Link className={styles.secondary} href={safeReturnTo}>
          改為一般站內頁（不登入）
        </Link>
      </div>
    </div>
  )
}
