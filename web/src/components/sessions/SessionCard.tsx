import Link from 'next/link'
import SessionStatusBadge from './SessionStatusBadge'
import styles from './SessionCard.module.css'

interface SessionCardProps {
  session: {
    id: string
    title: string
    status: string
    start_at: string
    end_at: string
    court_count: number
    allow_self_signup: boolean
    venues?: { name: string } | null
    session_participants: { count: number }[]
  }
}

export default function SessionCard({ session }: SessionCardProps) {
  const startDate = new Date(session.start_at)
  const endDate = new Date(session.end_at)
  const participantCount = session.session_participants?.[0]?.count ?? 0

  const formatDate = (d: Date) =>
    d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', weekday: 'short' })

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })

  return (
    <Link href={`/sessions/${session.id}`} className={styles.card}>
      <div className={styles.cardTop}>
        <SessionStatusBadge status={session.status} />
        {session.allow_self_signup && (
          <span className={styles.signupTag}>🔗 可線上報名</span>
        )}
      </div>

      <h3 className={styles.title}>{session.title}</h3>

      <div className={styles.meta}>
        <div className={styles.metaItem}>
          <span className={styles.metaIcon}>📅</span>
          <span>{formatDate(startDate)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaIcon}>🕐</span>
          <span>{formatTime(startDate)} – {formatTime(endDate)}</span>
        </div>
        {session.venues?.name && (
          <div className={styles.metaItem}>
            <span className={styles.metaIcon}>📍</span>
            <span>{session.venues.name}</span>
          </div>
        )}
      </div>

      <div className={styles.cardBottom}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{participantCount}</span>
          <span className={styles.statLabel}>位球員</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{session.court_count}</span>
          <span className={styles.statLabel}>面場地</span>
        </div>
        <span className={styles.arrow}>→</span>
      </div>
    </Link>
  )
}
