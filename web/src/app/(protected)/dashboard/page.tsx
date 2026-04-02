'use client'

import { useUser } from '@/hooks/useUser'
import QuotaCard from '@/components/dashboard/QuotaCard'
import styles from './dashboard.module.css'
import Link from 'next/link'

const quickActions = [
  { label: '建立場次', href: '/sessions/new', icon: '🏸', color: 'blue' },
  { label: '球員名單', href: '/players', icon: '👥', color: 'green' },
  { label: '帳務總覽', href: '/billing', icon: '💰', color: 'orange' },
  { label: '平台設定', href: '/settings', icon: '⚙️', color: 'purple' },
]

export default function DashboardPage() {
  const { user } = useUser()
  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || '使用者'

  return (
    <div className={styles.dashboard}>
      {/* Welcome Section */}
      <section className={styles.welcome}>
        <div>
          <h1 className={styles.welcomeTitle}>
            嗨，<span className="text-gradient">{displayName}</span> 👋
          </h1>
          <p className={styles.welcomeSub}>歡迎回到羽球排組管理平台，以下是您的管理總覽。</p>
        </div>
        <Link href="/sessions/new" className={`btn btn-primary ${styles.welcomeBtn}`}>
          ＋ 建立新場次
        </Link>
      </section>

      {/* Quota Card */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>配額概覽</h2>
        <QuotaCard />
      </section>

      {/* Quick Actions */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>快速操作</h2>
        <div className={styles.quickGrid}>
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`${styles.quickCard} ${styles[action.color]}`}
            >
              <span className={styles.quickIcon}>{action.icon}</span>
              <span className={styles.quickLabel}>{action.label}</span>
              <span className={styles.quickArrow}>→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent Sessions */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>近期場次</h2>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📋</span>
          <p className={styles.emptyTitle}>目前沒有場次記錄</p>
          <p className={styles.emptyDesc}>開始建立您的第一個羽球場次！</p>
          <Link href="/sessions/new" className="btn btn-ghost">
            建立場次
          </Link>
        </div>
      </section>
    </div>
  )
}
