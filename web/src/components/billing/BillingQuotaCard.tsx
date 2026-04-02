'use client'

import { useEffect, useState, useRef } from 'react'
import styles from './BillingQuotaCard.module.css'

interface BillingQuotaCardProps {
  quotaUsed: number
  quotaLimit: number
  planCode: string | null
  periodEnd: string | null
  subscriptionStatus: string | null
}

export default function BillingQuotaCard({
  quotaUsed,
  quotaLimit,
  planCode,
  periodEnd,
  subscriptionStatus,
}: BillingQuotaCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [animatedPercent, setAnimatedPercent] = useState(0)

  const percent = quotaLimit > 0 ? Math.min((quotaUsed / quotaLimit) * 100, 100) : 0
  const remaining = Math.max(quotaLimit - quotaUsed, 0)

  // Animate ring
  useEffect(() => {
    let frame: number
    const start = performance.now()
    const duration = 800

    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      setAnimatedPercent(eased * percent)
      if (progress < 1) frame = requestAnimationFrame(animate)
    }

    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [percent])

  // Draw ring
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const size = 140
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const radius = 58
    const lineWidth = 10

    // Background track
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.stroke()

    // Progress arc
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + (animatedPercent / 100) * Math.PI * 2

    if (animatedPercent > 0) {
      const gradient = ctx.createConicGradient(startAngle, cx, cy)
      if (animatedPercent > 80) {
        gradient.addColorStop(0, '#ff6b6b')
        gradient.addColorStop(1, '#ee5a24')
      } else if (animatedPercent > 60) {
        gradient.addColorStop(0, '#ffa502')
        gradient.addColorStop(1, '#ff6348')
      } else {
        gradient.addColorStop(0, '#7c5cfc')
        gradient.addColorStop(1, '#00d2ff')
      }

      ctx.beginPath()
      ctx.arc(cx, cy, radius, startAngle, endAngle)
      ctx.strokeStyle = gradient
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.stroke()
    }
  }, [animatedPercent])

  const statusLabel = (() => {
    switch (subscriptionStatus) {
      case 'active': return '使用中'
      case 'trialing': return '試用中'
      case 'past_due': return '逾期'
      case 'cancelled': return '已取消'
      case 'expired': return '已過期'
      default: return '未訂閱'
    }
  })()

  const statusColor = (() => {
    switch (subscriptionStatus) {
      case 'active': return 'green'
      case 'trialing': return 'blue'
      case 'past_due': return 'orange'
      default: return 'gray'
    }
  })()

  const planLabel = (() => {
    switch (planCode) {
      case 'personal_monthly_350': return '個人月費方案'
      case 'org_5_hosts_1500': return '團體方案 (5席)'
      default: return '免費試用'
    }
  })()

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>配額用量</h3>
          <span className={`${styles.badge} ${styles[statusColor]}`}>{statusLabel}</span>
        </div>
        <span className={styles.plan}>{planLabel}</span>
      </div>

      <div className={styles.body}>
        <div className={styles.ringWrap}>
          <canvas ref={canvasRef} className={styles.canvas} />
          <div className={styles.ringCenter}>
            <span className={styles.ringValue}>{remaining}</span>
            <span className={styles.ringLabel}>剩餘</span>
          </div>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{quotaUsed}</span>
            <span className={styles.statLabel}>已使用</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{quotaLimit}</span>
            <span className={styles.statLabel}>總額度</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{Math.round(percent)}%</span>
            <span className={styles.statLabel}>使用率</span>
          </div>
        </div>
      </div>

      {periodEnd && (
        <div className={styles.footer}>
          週期結束：{new Date(periodEnd).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })}
        </div>
      )}
    </div>
  )
}
