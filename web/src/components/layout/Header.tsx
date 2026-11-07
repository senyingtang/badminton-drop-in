'use client'

import { createClient } from '@/lib/supabase/client'
import NotificationBell from './NotificationBell'
import styles from './Header.module.css'

interface HeaderProps {
  userEmail?: string | null
  onMenuToggle?: () => void
}

export default function Header({ userEmail, onMenuToggle }: HeaderProps) {
  const supabase = createClient()

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      // 整頁重載：即使 signOut 網路失敗也會離開，並讓 middleware 以清除後的 Cookie 重新判斷
      window.location.assign('/login')
    }
  }

  return (
    <header className={`${styles.header} header-fixed`}>
      <div className={styles.left}>
        <button className={styles.menuBtn} onClick={onMenuToggle} aria-label="Toggle menu">
          <span className={styles.menuIcon}>☰</span>
        </button>
        <div className={styles.breadcrumb}>
          <span className={styles.breadcrumbItem}>首頁</span>
        </div>
      </div>

      <div className={styles.right}>
        {userEmail && <NotificationBell />}
        <div className={styles.userMenu}>
          <div className={styles.avatar}>
            {userEmail ? userEmail[0].toUpperCase() : '?'}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.userEmail}>{userEmail || '未登入'}</span>
          </div>
          <button className={styles.signOutBtn} onClick={handleSignOut}>
            登出
          </button>
        </div>
      </div>
    </header>
  )
}
