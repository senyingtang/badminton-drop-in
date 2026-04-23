'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@/hooks/useUser'
import { useProfileSync } from '@/hooks/useProfileSync'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import Link from 'next/link'
import styles from './protected.module.css'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { user, loading } = useUser()
  const router = useRouter()
  const pathname = usePathname()
  useProfileSync(user)

  /** 與 middleware 不同步時（例如手機 Cookie／儲存被阻擋），避免在 user 為空時仍渲染子頁而誤顯空資料 */
  useEffect(() => {
    if (loading) return
    if (user) return
    const returnTo =
      pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/dashboard'
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }, [loading, user, router, pathname])

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingSpinner} />
        <p>載入中...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingSpinner} />
        <p>登入狀態失效，將帶您重新登入…</p>
      </div>
    )
  }

  const isMemberArea = pathname === '/member-dashboard' || pathname.startsWith('/member-dashboard/')

  return (
    <>
      {isMemberArea ? (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              backdropFilter: 'blur(10px)',
              background: 'rgba(0,0,0,0.35)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <Link href="/member-dashboard" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 800 }}>
                🏸 羽球排組
              </Link>
              <nav style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href="/member-dashboard" style={{ color: 'var(--text-secondary)' }}>會員中心</Link>
                <Link href="/member-dashboard/dropins" style={{ color: 'var(--text-secondary)' }}>全台臨打</Link>
                <Link href="/s/" style={{ color: 'var(--text-secondary)' }}>臨打報名</Link>
              </nav>
              <div style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                {user.email}
              </div>
            </div>
          </header>
          <main style={{ flex: 1 }}>{children}</main>
          <footer style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '18px 16px', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
              © 羽球排組平台
            </div>
          </footer>
        </div>
      ) : (
        <div className={`${styles.layout} ${sidebarCollapsed ? styles.collapsed : ''}`}>
          <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
          <Header userEmail={user?.email} onMenuToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
          <main className={styles.main}>{children}</main>
        </div>
      )}
    </>
  )
}
