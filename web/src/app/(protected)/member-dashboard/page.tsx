import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import styles from './member-dashboard.module.css'

export default async function MemberDashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected layout 會處理未登入導向；這裡僅做保底
  if (!user) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>會員中心</h1>
          <p className={styles.desc}>登入狀態失效，請重新登入。</p>
          <Link className={styles.btn} href="/login">
            前往登入
          </Link>
        </div>
      </div>
    )
  }

  // 取得 player 綁定狀態（OA UID / 既有 line_user_id 皆視為已綁定通知）
  const { data: p } = await supabase
    .from('players')
    .select('player_code, line_oa_user_id, line_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  const playerCode = (p as any)?.player_code ? String((p as any).player_code) : ''
  const lineUid = (p as any)?.line_oa_user_id || (p as any)?.line_user_id || ''

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>🙋 會員中心</h1>
        <p className={styles.subtitle}>管理您的通知綁定與基本資訊。</p>
      </header>

      <section className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>通知綁定（LINE@）</h2>
          {lineUid ? (
            <>
              <p className={styles.ok}>✓ 已綁定，可接收名單異動通知</p>
              <p className={styles.desc}>若需更換綁定，請先聯絡管理員協助解除，再重新綁定。</p>
            </>
          ) : (
            <>
              <p className={styles.warn}>尚未綁定：名單變動將無法第一時間通知</p>
              <p className={styles.desc}>
                請先點「產生綁定代碼」，再到 LINE 官方帳號聊天室輸入：<code>綁定 代碼</code>
              </p>
              <Link className={styles.btn} href="/member-dashboard/line-binding">
                產生綁定代碼
              </Link>
            </>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>球員代碼</h2>
          <p className={styles.desc}>此代碼用於辨識您的球員資料。</p>
          <div className={styles.codeBox}>{playerCode || '（尚未建立）'}</div>
          {!playerCode && (
            <p className={styles.desc}>
              若您尚未有球員資料，請先完成一次報名或到設定頁建立球員資料。
            </p>
          )}
          <Link className={styles.link} href="/settings">
            前往設定
          </Link>
        </div>
      </section>
    </div>
  )
}

