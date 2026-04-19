'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/hooks/useUser'
import { createClient } from '@/lib/supabase/client'
import styles from './admin-layout.module.css'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [authorized, setAuthorized] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push(`/login?returnTo=${encodeURIComponent(pathname)}`)
      } else {
        const checkRole = async () => {
          const { data } = await supabase.from('app_user_profiles').select('primary_role').eq('id', user.id).single()
          if (data?.primary_role !== 'platform_admin') {
             router.push('/dashboard')
          } else {
             setAuthorized(true)
          }
        }
        checkRole()
      }
    }
  }, [user, loading, router, pathname, supabase])

  if (!authorized) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>驗證權限中...</p>
      </div>
    )
  }

  const navItems = [
    { label: '後台首頁', href: '/dashboard' },
    { label: 'LINE 整合', href: '/line' },
    { label: '使用者管理', href: '/users' },
    { label: '操作稽核', href: '/audit' },
    { label: 'AI 整合', href: '/ai' },
  ]

  return (
    <div className={styles.layout}>
      {/* Top Navbar specifically for Admin */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.icon}>🛠️</span>
          <span className={styles.title}>平台管理後台</span>
        </div>
        <nav className={styles.nav}>
          {navItems.map((item) => (
            <Link 
              key={item.href} 
              href={`/admin${item.href}`}
              className={`${styles.navItem} ${pathname === `/admin${item.href}` ? styles.active : ''}`}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/dashboard" className={styles.navItem}>← 返回一般平台</Link>
        </nav>
      </header>

      <main className={styles.content}>
        {children}
      </main>
    </div>
  )
}
