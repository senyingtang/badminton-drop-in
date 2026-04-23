import styles from '../member-dashboard.module.css'

export default function DropinsPage() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>📍 全台臨打</h1>
        <p className={styles.subtitle}>此功能尚在規劃中（將提供搜尋、縣市篩選、以及直接前往報名）。</p>
      </header>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>即將提供</h2>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <li>依縣市/日期/費用篩選</li>
          <li>臨打團卡片清單（含 LINE@ 加好友與報名入口）</li>
          <li>點擊後導向場次報名頁（/s/[code]）</li>
        </ul>
      </div>
    </div>
  )
}

