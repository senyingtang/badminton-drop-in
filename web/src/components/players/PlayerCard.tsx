'use client'

import Link from 'next/link'
import styles from './PlayerCard.module.css'

interface PlayerCardProps {
  playerId: string
  displayName: string
  playerCode: string
  level?: number | null
  warningStatus?: string
}

const warningLabels: Record<string, { label: string; color: string }> = {
  warned: { label: '⚠ 警示', color: 'orange' },
  blacklisted: { label: '🚫 黑名單', color: 'red' },
}

export default function PlayerCard({
  playerId,
  displayName,
  playerCode,
  level,
  warningStatus = 'normal',
}: PlayerCardProps) {
  const warning = warningLabels[warningStatus]

  return (
    <Link href={`/players/${playerId}`} className={styles.card}>
      <div className={styles.avatar}>
        {displayName.charAt(0).toUpperCase()}
      </div>
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{displayName}</span>
          {warning && (
            <span className={`${styles.badge} ${styles[warning.color]}`}>
              {warning.label}
            </span>
          )}
        </div>
        <span className={styles.code}>{playerCode}</span>
      </div>
      <div className={styles.stats}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{level ?? '—'}</span>
          <span className={styles.statLabel}>級數</span>
        </div>
      </div>
    </Link>
  )
}
