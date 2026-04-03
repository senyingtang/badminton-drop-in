import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProfileForm from '@/components/settings/ProfileForm'
import SecurityCard from '@/components/settings/SecurityCard'
import styles from './settings.module.css'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          <span style={{ fontSize: '1.5rem' }}>⚙️</span> 平台設定
        </h1>
        <p className={styles.subtitle}>管理您的帳號資訊、安全性與系統偏好。</p>
      </div>

      <ProfileForm user={user} />
      <SecurityCard userEmail={user.email} />
      
      {/* Future expansion area for Theme, Notifications, etc. */}
      {/* <PreferencesCard /> */}
    </div>
  )
}
