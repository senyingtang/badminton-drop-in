'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@/hooks/useUser'
import { useProfileSync } from '@/hooks/useProfileSync'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from './protected.module.css'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { user, loading, error: authError } = useUser()
  const router = useRouter()
  const pathname = usePathname()
  useProfileSync(user)

  /** 與 middleware 不同步時（例如手機 Cookie／儲存被阻擋），避免在 user 為空時仍渲染子頁而誤顯空資料 */
  useEffect(() => {
    if (loading) return
    if (user) return
    // 逾時不自動導向登入頁，避免「登入頁判定已登入 → 導回 → 再逾時」的循環
    if (authError === 'timeout') return
    const returnTo =
      pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/dashboard'
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }, [loading, user, authError, router, pathname])

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingSpinner} />
        <p>載入中...</p>
      </div>
    )
  }

  if (!user && authError === 'timeout') {
    return (
      <div className={styles.loadingScreen}>
        <p>登入狀態確認逾時，可能是網路不穩。</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新整理
        </button>
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
        <div className={styles.memberShell}>
          <header className={styles.memberTopNav}>
            <div className={styles.memberTopNavInner}>
              <div className={styles.memberBrandRow}>
                <Link href="/member-dashboard" className={styles.memberBrand}>
                  🏸 羽球排組
                </Link>
                <div className={styles.memberEmail} title={user.email || ''}>
                  {user.email}
                </div>
              </div>
              <nav className={styles.memberNavLinks} aria-label="會員導覽">
                <Link href="/member-dashboard" className={styles.memberNavLink}>
                  會員中心
                </Link>
                <Link href="/member-dashboard/dropins" className={styles.memberNavLink}>
                  全台臨打
                </Link>
                <button
                  type="button"
                  className={styles.memberNavLink}
                  style={{ cursor: 'pointer', font: 'inherit' }}
                  onClick={async () => {
                    try {
                      await createClient().auth.signOut()
                    } finally {
                      // 整頁重載，讓 middleware / SSR 以清除後的 Cookie 重新判斷
                      window.location.assign('/login')
                    }
                  }}
                >
                  登出
                </button>
              </nav>
            </div>
          </header>
          <main className={styles.memberContent}>{children}</main>
          <footer className={styles.memberFooter}>
            <div className={styles.memberTopNavInner}>© 羽球排組平台</div>
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
