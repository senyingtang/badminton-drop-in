'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from './Sidebar.module.css'

const baseNavItems = [
  {
    label: '總覽',
    href: '/dashboard',
    icon: '📊',
  },
  {
    label: '場次管理',
    href: '/sessions',
    icon: '🏸',
  },
  {
    label: '場館管理',
    href: '/venues',
    icon: '📍',
  },
  {
    label: '球員名單',
    href: '/players',
    icon: '👥',
  },
  {
    label: '帳務',
    href: '/billing',
    icon: '💰',
  },
  {
    label: '設定',
    href: '/settings',
    icon: '⚙️',
  },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function checkRole() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('app_user_profiles')
        .select('primary_role')
        .eq('id', user.id)
        .single()
      
      if (data?.primary_role === 'platform_admin') {
        setIsAdmin(true)
      }
    }
    checkRole()
  }, [supabase])

  const navItems = isAdmin 
    ? [...baseNavItems, { label: '管理後台', href: '/admin/dashboard', icon: '🛡️' }] 
    : baseNavItems

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandIcon}>🏸</div>
        {!collapsed && (
          <div className={styles.brandText}>
            <span className={styles.brandName}>羽球排組</span>
            <span className={styles.brandSub}>管理平台</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              title={collapsed ? item.label : undefined}
              onClick={() => {
                if (typeof window !== 'undefined' && window.innerWidth <= 768 && collapsed) {
                  onToggle()
                }
              }}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
              {isActive && <div className={styles.activeIndicator} />}
            </Link>
          )
        })}
      </nav>

      {/* Toggle */}
      <button className={styles.toggle} onClick={onToggle} aria-label="Toggle sidebar">
        <span className={styles.toggleIcon}>{collapsed ? '→' : '←'}</span>
      </button>
    </aside>
  )
}
