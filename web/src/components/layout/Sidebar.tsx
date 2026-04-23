'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import styles from './Sidebar.module.css'

const memberNavItems = [
  {
    label: '會員中心',
    href: '/member-dashboard',
    icon: '🙋',
  },
]

const managementNavItems = [
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
    label: '臨打團設置',
    href: '/pickup-group/settings',
    icon: '🏷️',
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
  const [role, setRole] = useState<'platform_admin' | 'venue_owner' | 'host' | 'player' | null>(null)
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
      const r = data?.primary_role
      if (r === 'platform_admin' || r === 'venue_owner' || r === 'host' || r === 'player') {
        setRole(r)
      } else {
        setRole(null)
      }
    }
    checkRole()
  }, [supabase])

  const isManagement = role === 'platform_admin' || role === 'venue_owner' || role === 'host'
  const navItems = isManagement ? managementNavItems : memberNavItems
  const fullNavItems =
    role === 'platform_admin' ? [...navItems, { label: '管理後台', href: '/admin/dashboard', icon: '🛡️' }] : navItems

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandIcon}>🏸</div>
        <div className={styles.brandText}>
          <span className={styles.brandName}>羽球排組</span>
          <span className={styles.brandSub}>管理平台</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {fullNavItems.map((item) => {
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
              <span className={styles.navLabel}>{item.label}</span>
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
