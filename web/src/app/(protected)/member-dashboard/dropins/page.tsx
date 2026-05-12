'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { absoluteUrl, liffQuickSignupEntryPath } from '@/lib/signupShareLinks'
import styles from '../member-dashboard.module.css'
import local from './dropins.module.css'

type SessionItem = {
  id: string
  title: string
  status: string
  statusLabel: string
  venueName: string
  address: string
  parsedCity: string
  parsedDistrict: string
  courts: string[]
  feeDisplay: string | null
  feeNote: string | null
  levelDisplay: string | null
  shareSignupCode: string | null
  dateTimeDisplay: string
  startAt: string
}

function buildGroups(rows: SessionItem[], cityFilter: string) {
  const filtered = cityFilter ? rows.filter((r) => r.parsedCity === cityFilter) : rows
  const byCity = new Map<string, Map<string, SessionItem[]>>()
  for (const r of filtered) {
    const c = r.parsedCity || '其他地區'
    const d = r.parsedDistrict || '未分類'
    if (!byCity.has(c)) byCity.set(c, new Map())
    const dm = byCity.get(c)!
    if (!dm.has(d)) dm.set(d, [])
    dm.get(d)!.push(r)
  }
  const cities = [...byCity.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  return { byCity, cities }
}

export default function DropinsPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cityFilter, setCityFilter] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/member/dropins/open')
        const j = (await res.json().catch(() => null)) as { ok?: boolean; sessions?: SessionItem[]; error?: string } | null
        if (cancelled) return
        if (!res.ok || !j?.ok) {
          setError(j?.error || `HTTP ${res.status}`)
          setSessions([])
          return
        }
        setSessions(j.sessions || [])
      } catch {
        if (!cancelled) {
          setError('network')
          setSessions([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const cityOptions = useMemo(() => {
    const set = new Set(sessions.map((s) => s.parsedCity).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [sessions])

  const { byCity, cities } = useMemo(() => buildGroups(sessions, cityFilter), [sessions, cityFilter])

  const copyLink = useCallback(async (s: SessionItem) => {
    if (!s.shareSignupCode) return
    const url = absoluteUrl(window.location.origin, liffQuickSignupEntryPath(s.shareSignupCode))
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(s.id)
      window.setTimeout(() => setCopiedId((cur) => (cur === s.id ? null : cur)), 2000)
    } catch {
      alert('無法複製連結，請手動複製。')
    }
  }, [])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>臨打報名</h1>
        <p className={styles.subtitle}>查看目前仍可報名的臨打團，依縣市與區域快速找到適合的場次。</p>
      </header>

      {loading && <p className={styles.desc}>載入中…</p>}
      {!loading && error && <p className={styles.warn}>臨打資訊載入失敗，請稍後再試。</p>}
      {!loading && !error && sessions.length === 0 && (
        <div className={styles.card}>
          <p className={styles.desc}>目前尚無開放報名的臨打團，請稍後再回來查看。</p>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className={local.toolbar}>
          <label className={local.filterLabel} htmlFor="dropin-city">
            縣市
          </label>
          <select
            id="dropin-city"
            className={local.select}
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          >
            <option value="">全部縣市</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {!loading &&
        !error &&
        sessions.length > 0 &&
        cities.map((city) => {
          const dm = byCity.get(city)!
          const districts = [...dm.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
          return (
            <section key={city} className={local.citySection}>
              <h2 className={local.cityHeading}>{city}</h2>
              {districts.map((district) => {
                const list = [...(dm.get(district) || [])].sort(
                  (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
                )
                return (
                  <div key={`${city}-${district}`} className={local.districtBlock}>
                    <h3 className={local.districtHeading}>{district}</h3>
                    <div className={local.cardGrid}>
                      {list.map((s) => (
                        <article key={s.id} className={local.dropinCard}>
                          <div className={local.cardTop}>
                            <span className={local.badge}>{s.statusLabel}</span>
                          </div>
                          <h4 className={local.cardTitle}>{s.title}</h4>
                          <p className={local.metaLine}>
                            <span className={local.metaIcon}>📅</span>
                            {s.dateTimeDisplay}
                          </p>
                          <p className={local.metaLine}>
                            <span className={local.metaIcon}>🏟</span>
                            {s.venueName}
                          </p>
                          <p className={local.metaLine}>
                            <span className={local.metaIcon}>📍</span>
                            {s.address}
                          </p>
                          {s.courts.length > 0 && (
                            <p className={local.metaLine}>
                              <span className={local.metaIcon}>🥅</span>
                              {s.courts.join('、')}
                            </p>
                          )}
                          <p className={local.metaLine}>
                            <span className={local.metaIcon}>💰</span>
                            {s.feeDisplay || (s.feeNote ? s.feeNote : '費用以公告為準')}
                          </p>
                          <p className={local.metaLine}>
                            <span className={local.metaIcon}>🏸</span>
                            {s.levelDisplay ?? '級數請見報名頁說明'}
                          </p>
                          <div className={local.actions}>
                            {s.shareSignupCode ? (
                              <>
                                <Link className={local.linePrimary} href={liffQuickSignupEntryPath(s.shareSignupCode)}>
                                  LINE App 快速報名
                                </Link>
                                <Link className={styles.ghostBtn} href={`/s/${encodeURIComponent(s.shareSignupCode)}`}>
                                  一般報名頁
                                </Link>
                                <button type="button" className={styles.ghostBtn} onClick={() => void copyLink(s)}>
                                  {copiedId === s.id ? '已複製' : '複製連結'}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}
    </div>
  )
}
