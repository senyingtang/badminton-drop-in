import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProfileForm from '@/components/settings/ProfileForm'
import PlayerHandleCard from '@/components/settings/PlayerHandleCard'
import SecurityCard from '@/components/settings/SecurityCard'
import styles from './settings.module.css'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('app_user_profiles')
    .select('primary_role')
    .eq('id', user.id)
    .maybeSingle()

  const isPlatformAdmin = profile?.primary_role === 'platform_admin'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          <span style={{ fontSize: '1.5rem' }}>⚙️</span> 平台設定
        </h1>
        <p className={styles.subtitle}>管理您的帳號資訊、安全性與系統偏好。</p>
      </div>

      {isPlatformAdmin && (
        <aside className={styles.adminNotice} aria-label="平台管理員專區">
          <h2 className={styles.adminNoticeTitle}>
            <span>🛠️</span> 平台管理員
          </h2>
          <p className={styles.adminNoticeText}>
            <strong>LINE Messaging API</strong> 與 <strong>LINE Login</strong> 的 Channel ID、secret、access token
            不在此「平台設定」頁填寫；請至<strong>管理後台 → LINE 整合</strong>維護（僅您可存取）。
          </p>
          <div className={styles.adminNoticeLinks}>
            <Link href="/admin/line" className={styles.adminNoticeLink}>
              開啟 LINE 整合
            </Link>
            <Link href="/admin/dashboard" className={styles.adminNoticeLink}>
              管理後台首頁
            </Link>
          </div>
        </aside>
      )}

      <ProfileForm user={user} />
      <PlayerHandleCard userId={user.id} />
      <SecurityCard userEmail={user.email} />

      {/* Future expansion area for Theme, Notifications, etc. */}
      {/* <PreferencesCard /> */}
    </div>
  )
}
