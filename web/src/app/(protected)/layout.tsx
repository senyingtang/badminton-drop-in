'use client'

import { useState } from 'react'
import { useUser } from '@/hooks/useUser'
import { useProfileSync } from '@/hooks/useProfileSync'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import styles from './protected.module.css'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { user, loading } = useUser()
  useProfileSync(user)

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingSpinner} />
        <p>載入中...</p>
      </div>
    )
  }

  return (
    <div className={`${styles.layout} ${sidebarCollapsed ? styles.collapsed : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <Header
        userEmail={user?.email}
        onMenuToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
