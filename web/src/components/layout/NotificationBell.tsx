'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import styles from './NotificationBell.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Notification = any

export default function NotificationBell() {
  const { user } = useUser()
  const supabase = createClient()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from('kb_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (data) {
        setNotifications(data)
        setUnreadCount(data.filter((n: Notification) => !n.is_read).length)
      }
    }

    fetchNotifications()

    // Realtime subscription
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'kb_notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 20))
          setUnreadCount((prev) => prev + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, supabase])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMarkAllRead = async () => {
    if (!user) return
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length === 0) return

    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)

    await supabase
      .from('kb_notifications')
      .update({ is_read: true })
      .in('id', unreadIds)
  }

  const handleMarkRead = async (id: string, is_read: boolean) => {
      if (is_read) return
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
      await supabase.from('kb_notifications').update({ is_read: true }).eq('id', id)
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <button 
        className={styles.bellBtn} 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
      >
        <span className={styles.icon}>🔔</span>
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <h3 className={styles.title}>通知中心</h3>
            {unreadCount > 0 && (
              <button className={styles.markAll} onClick={handleMarkAllRead}>
                全部標記為已讀
              </button>
            )}
          </div>
          
          <div className={styles.list}>
            {notifications.length === 0 ? (
              <div className={styles.empty}>尚無任何通知</div>
            ) : (
              notifications.map((n) => (
                <div 
                  key={n.id} 
                  className={`${styles.item} ${!n.is_read ? styles.unreadItem : ''}`}
                  onClick={() => handleMarkRead(n.id, n.is_read)}
                >
                  <div className={styles.itemHeader}>
                    <span className={styles.itemTitle}>{n.title}</span>
                    {!n.is_read && <span className={styles.dot} />}
                  </div>
                  {n.body && <p className={styles.itemBody}>{n.body}</p>}
                  <span className={styles.time}>{new Date(n.created_at).toLocaleDateString()} {new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
