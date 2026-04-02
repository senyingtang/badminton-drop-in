import styles from './SessionStatusBadge.module.css'

const statusConfig: Record<string, { label: string; color: string }> = {
  draft:                  { label: '草稿',     color: 'gray' },
  pending_confirmation:   { label: '待確認',   color: 'blue' },
  ready_for_assignment:   { label: '待排組',   color: 'orange' },
  assigned:               { label: '已排組',   color: 'purple' },
  in_progress:            { label: '進行中',   color: 'green' },
  round_finished:         { label: '輪次結束', color: 'blue' },
  session_finished:       { label: '已結束',   color: 'purple' },
  cancelled:              { label: '已取消',   color: 'red' },
}

interface SessionStatusBadgeProps {
  status: string
}

export default function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const config = statusConfig[status] || { label: status, color: 'gray' }

  return (
    <span className={`${styles.badge} ${styles[config.color]}`}>
      <span className={styles.dot} />
      {config.label}
    </span>
  )
}
