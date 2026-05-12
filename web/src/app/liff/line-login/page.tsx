'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { isSafeInternalReturnPath, LIFF_ENTRY_INVALID_FALLBACK } from '@/lib/safeInternalReturnPath'
import styles from './liff-line-login.module.css'

const STORAGE_RETURN = 'kb_liff_line_return_to'
const STORAGE_REF = 'kb_liff_line_ref'

declare global {
  interface Window {
    liff?: {
      init: (config: { liffId: string }) => Promise<void>
      isLoggedIn: () => boolean
      login: (config?: { redirectUri?: string }) => void
    }
  }
}

function loadLiffSdk(): Promise<void> {
  if (window.liff) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('LIFF SDK 載入失敗'))
    document.body.appendChild(s)
  })
}

function lineStartHref(returnTo: string, ref: string): string {
  const u = new URL('/api/auth/line/start', window.location.origin)
  u.searchParams.set('returnTo', returnTo)
  if (ref) u.searchParams.set('referralCode', ref)
  return u.pathname + u.search
}

function resolveReturnTo(sp: URLSearchParams): string {
  const qp = sp.get('returnTo')
  if (qp && isSafeInternalReturnPath(qp)) {
    const v = qp.trim()
    try {
      sessionStorage.setItem(STORAGE_RETURN, v)
    } catch {
      // ignore
    }
    return v
  }
  try {
    const st = sessionStorage.getItem(STORAGE_RETURN)
    if (st && isSafeInternalReturnPath(st)) return st.trim()
  } catch {
    // ignore
  }
  return LIFF_ENTRY_INVALID_FALLBACK
}

function resolveRef(sp: URLSearchParams): string {
  const qp = sp.get('ref')
  if (qp && qp.trim()) {
    try {
      sessionStorage.setItem(STORAGE_REF, qp.trim())
    } catch {
      // ignore
    }
    return qp.trim()
  }
  try {
    return sessionStorage.getItem(STORAGE_REF)?.trim() || ''
  } catch {
    return ''
  }
}

function LiffLineLoginInner() {
  const searchParams = useSearchParams()
  const [msg, setMsg] = useState('初始化 LIFF…')
  const [returnTo, setReturnTo] = useState(LIFF_ENTRY_INVALID_FALLBACK)
  const [ref, setRef] = useState('')

  const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID?.trim()
  const liffIdMissing = !liffId
  const spKey = searchParams.toString()

  useEffect(() => {
    const rt = resolveReturnTo(searchParams)
    const rf = resolveRef(searchParams)
    setReturnTo(rt)
    setRef(rf)

    if (liffIdMissing) {
      setMsg('未設定 NEXT_PUBLIC_LINE_LIFF_ID，請改用 Web LINE Login。')
      return
    }

    let alive = true
    void (async () => {
      try {
        await loadLiffSdk()
        if (!alive || !window.liff) {
          if (alive) setMsg('無法載入 LINE LIFF SDK。')
          return
        }
        await window.liff.init({ liffId: liffId! })
        if (!alive) return

        if (!window.liff.isLoggedIn()) {
          if (alive) setMsg('請在 LINE 內完成登入…')
          const redirectUri = `${window.location.origin}/liff/line-login`
          window.liff.login({ redirectUri })
          return
        }

        if (alive) setMsg('正在銜接本站登入…')
        window.location.replace(lineStartHref(rt, rf))
      } catch (e) {
        if (alive) setMsg(e instanceof Error ? e.message : 'LIFF 初始化失敗')
      }
    })()

    return () => {
      alive = false
    }
  }, [liffId, liffIdMissing, spKey, searchParams])

  return (
    <div className={styles.wrap}>
      <p className={styles.status}>{msg}</p>
      {liffIdMissing ? (
        <div className={styles.links}>
          <a className={styles.primary} href={lineStartHref(returnTo, ref)}>
            改用 Web LINE Login
          </a>
          <Link className={styles.secondary} href={returnTo}>
            返回報名頁
          </Link>
        </div>
      ) : (
        <p className={styles.hint}>
          若畫面停滯，可改用手動連結：
          <a href={lineStartHref(returnTo, ref)}>Web LINE Login</a>
        </p>
      )}
    </div>
  )
}

export default function LiffLineLoginPage() {
  return (
    <Suspense fallback={<div className={styles.wrap}>載入中…</div>}>
      <LiffLineLoginInner />
    </Suspense>
  )
}
