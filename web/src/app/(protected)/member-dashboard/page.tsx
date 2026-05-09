import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ReferralCodeSection from './ReferralCodeSection'
import styles from './member-dashboard.module.css'

function firstRpcRecord(data: unknown): Record<string, unknown> | null {
  if (data == null) return null
  if (Array.isArray(data)) {
    const r = data[0]
    return r && typeof r === 'object' ? (r as Record<string, unknown>) : null
  }
  if (typeof data === 'object') return data as Record<string, unknown>
  return null
}

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

  const pr = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
  const playerCode = typeof pr?.player_code === 'string' ? pr.player_code : ''
  const lineUid =
    (typeof pr?.line_oa_user_id === 'string' ? pr.line_oa_user_id : '') ||
    (typeof pr?.line_user_id === 'string' ? pr.line_user_id : '')

  // 取得 LINE@ 加好友連結（供會員中心也能導流）
  const { data: oaData } = await supabase.rpc('get_public_platform_line_oa')
  const oaRow = firstRpcRecord(oaData)
  const oaAddFriendUrl =
    oaRow && typeof oaRow.oa_add_friend_url === 'string' ? oaRow.oa_add_friend_url.trim() : ''

  let referralCode: string | null = null
  let referralSetupError: string | null = null
  const { data: ensured, error: ensureErr } = await supabase.rpc('ensure_member_referral_profile', {
    p_user_id: user.id,
  })
  if (ensureErr) {
    referralSetupError = ensureErr.message
  } else {
    const row = firstRpcRecord(ensured)
    referralCode = row && typeof row.referral_code === 'string' ? row.referral_code : null
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>🙋 會員中心</h1>
        <p className={styles.subtitle}>管理您的通知綁定與基本資訊。</p>
      </header>

      <section className={styles.grid}>
        {referralSetupError ? (
          <div className={styles.card} style={{ gridColumn: '1 / -1' }}>
            <h2 className={styles.cardTitle}>推薦代碼尚未就緒</h2>
            <p className={styles.desc}>
              無法建立推薦資料：{referralSetupError}。請在 Supabase 執行{' '}
              <code>docs/069_referral_phase1_profiles_and_links.sql</code> 後重新整理。
            </p>
          </div>
        ) : referralCode ? (
          <ReferralCodeSection referralCode={referralCode} />
        ) : null}
        {oaAddFriendUrl && (
          <div className={styles.card} style={{ gridColumn: '1 / -1' }}>
            <h2 className={styles.cardTitle}>加入 LINE@（通知與客服）</h2>
            <p className={styles.desc}>
              建議先加入官方帳號，才能在名單異動時收到通知，也能在聊天室輸入「綁定 代碼」完成通知綁定。
            </p>
            <Link className={styles.btn} href={oaAddFriendUrl} target="_blank" rel="noreferrer">
              加入 LINE@
            </Link>
          </div>
        )}
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
          <p className={styles.desc}>（球員端不提供後台設定頁；若需協助請聯絡管理員。）</p>
        </div>
      </section>
    </div>
  )
}

