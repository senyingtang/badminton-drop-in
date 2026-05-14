'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { isSafeInternalReturnPath, LIFF_ENTRY_INVALID_FALLBACK } from '@/lib/safeInternalReturnPath'
import { postPublicSignupErrorFromClient } from '@/lib/publicSignupErrorLog'
import styles from './liff-line-login.module.css'

const STORAGE_RETURN = 'kb_liff_line_return_to'
const STORAGE_REF = 'kb_liff_line_ref'

function liffAttemptKey(returnTo: string): string {
  return `kb_liff_login_attempts:${returnTo}`
}

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

function buildLineLoginRedirectUri(returnTo: string, ref: string): string {
  const u = new URL(`${window.location.origin}/liff/line-login`)
  u.searchParams.set('returnTo', returnTo)
  const r = ref.trim()
  if (r) u.searchParams.set('ref', r)
  return u.toString()
}

function resolveReturnTo(sp: URLSearchParams): { path: string; lost: boolean } {
  const qp = sp.get('returnTo')
  if (qp && isSafeInternalReturnPath(qp)) {
    const v = qp.trim()
    try {
      sessionStorage.setItem(STORAGE_RETURN, v)
    } catch {
      // ignore
    }
    return { path: v, lost: false }
  }
  try {
    const st = sessionStorage.getItem(STORAGE_RETURN)
    if (st && isSafeInternalReturnPath(st)) return { path: st.trim(), lost: false }
  } catch {
    // ignore
  }
  return { path: LIFF_ENTRY_INVALID_FALLBACK, lost: true }
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
  const [msgTone, setMsgTone] = useState<'muted' | 'error'>('muted')
  const [returnTo, setReturnTo] = useState(LIFF_ENTRY_INVALID_FALLBACK)
  const [ref, setRef] = useState('')
  const [loopBlocked, setLoopBlocked] = useState(false)
  const loginDispatched = useRef(false)

  const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID?.trim()
  const liffIdMissing = !liffId
  const spKey = searchParams.toString()

  useEffect(() => {    const resolved = resolveReturnTo(searchParams)
    const rf = resolveRef(searchParams)
    setReturnTo(resolved.path)
    setRef(rf)

    if (resolved.lost) {
      void postPublicSignupErrorFromClient({
        share_signup_code: null,
        session_id: null,
        flow: 'liff_line_login',
        error_code: 'LIFF_RETURN_TO_LOST',
        error_message: 'returnTo missing; using fallback',
        payload_snapshot: { fallback: LIFF_ENTRY_INVALID_FALLBACK },
      })
    }

    if (liffIdMissing) {
      setMsg('未設定 NEXT_PUBLIC_LINE_LIFF_ID，請改用 Web LINE Login。')
      setMsgTone('error')
      return
    }

    let alive = true
    void (async () => {
      try {
        await loadLiffSdk()
        if (!alive || !window.liff) {
          if (alive) {
            setMsgTone('error')
            setMsg('無法載入 LINE LIFF SDK。')
            void postPublicSignupErrorFromClient({
              share_signup_code: null,
              session_id: null,
              flow: 'liff_line_login',
              error_code: 'LIFF_INIT_FAILED',
              error_message: 'liff sdk missing after load',
            })
          }
          return
        }
        await window.liff.init({ liffId: liffId! })
        if (!alive) return

        if (!window.liff.isLoggedIn()) {
          if (loginDispatched.current) return
          loginDispatched.current = true
          const key = liffAttemptKey(resolved.path)
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
            if (alive) {
              setLoopBlocked(true)
              setMsgTone('error')
              setMsg('LINE 登入重複跳轉，請改用 LINE App 開啟或重新整理後再試。')
              void postPublicSignupErrorFromClient({
                share_signup_code: null,
                session_id: null,
                flow: 'liff_line_login',
                error_code: 'LIFF_LOGIN_LOOP_DETECTED',
                error_message: `liff.login attempts=${n}`,
                payload_snapshot: { returnTo: resolved.path, ref: rf || null },
              })
            }
            return
          }

          if (alive) setMsg('請在 LINE 內完成登入…')
          const redirectUri = buildLineLoginRedirectUri(resolved.path, rf)
          window.liff.login({ redirectUri })
          return
        }

        if (alive) setMsg('正在銜接本站登入…')
        try {
          sessionStorage.removeItem(liffAttemptKey(resolved.path))
        } catch {
          // ignore
        }
        window.location.replace(lineStartHref(resolved.path, rf))
      } catch (e) {
        const m = e instanceof Error ? e.message : 'LIFF 初始化失敗'
        if (alive) {
          setMsgTone('error')
          setMsg(m)
          void postPublicSignupErrorFromClient({
            share_signup_code: null,
            session_id: null,
            flow: 'liff_line_login',
            error_code: 'LIFF_INIT_FAILED',
            error_message: m,
            error_detail: { name: e instanceof Error ? e.name : 'Error' },
          })
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [liffId, liffIdMissing, spKey, searchParams])

  return (
    <div className={styles.wrap}>
      <p className={msgTone === 'error' ? styles.statusError : styles.status}>{msg}</p>
      {loopBlocked ? (
        <p className={styles.mono}>錯誤代碼：LIFF_LOGIN_LOOP_DETECTED</p>
      ) : null}
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
