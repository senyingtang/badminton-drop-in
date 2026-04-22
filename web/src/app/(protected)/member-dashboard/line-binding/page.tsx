import Link from 'next/link'
import styles from '../member-dashboard.module.css'

type ApiRes =
  | { ok: true; bound: true; lineOaUserId: string }
  | { ok: true; bound: false; code: string; expiresAt: string }
  | { ok: false; error: string }

export default async function LineBindingPage() {
  // 同源 fetch（Next 會自動帶上 cookie），用於取得/建立綁定碼
  const res = await fetch('/api/line/binding-code', { cache: 'no-store' }).catch(() => null)

  let data: ApiRes | null = null
  if (res) {
    data = (await res.json().catch(() => null)) as ApiRes | null
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>🔗 綁定 LINE@ 通知</h1>
        <p className={styles.subtitle}>綁定後，名單異動會第一時間透過 LINE 通知您。</p>
      </header>

      <div className={styles.card}>
        {!data || !('ok' in data) ? (
          <>
            <p className={styles.warn}>無法取得綁定資訊，請稍後再試。</p>
            <Link className={styles.link} href="/member-dashboard">
              回會員中心
            </Link>
          </>
        ) : data.ok && data.bound ? (
          <>
            <p className={styles.ok}>✓ 已綁定（LINE UID：{data.lineOaUserId}）</p>
            <p className={styles.desc}>若需更換綁定，請先聯絡管理員協助解除後再重新綁定。</p>
            <Link className={styles.link} href="/member-dashboard">
              回會員中心
            </Link>
          </>
        ) : data.ok && !data.bound ? (
          <>
            <p className={styles.desc}>請到 LINE 官方帳號聊天室輸入以下指令：</p>
            <div className={styles.codeBox}>綁定 {data.code}</div>
            <p className={styles.desc}>代碼有效期限至：{new Date(data.expiresAt).toLocaleString('zh-TW')}</p>
            <p className={styles.desc}>綁定成功後回到會員中心，即會顯示「已綁定」。</p>
            <Link className={styles.link} href="/member-dashboard">
              回會員中心
            </Link>
          </>
        ) : (
          <>
            <p className={styles.warn}>取得綁定代碼失敗：{(data as any).error}</p>
            <p className={styles.desc}>請確認已登入，且伺服端已設定 SUPABASE_SERVICE_ROLE_KEY。</p>
            <Link className={styles.link} href="/member-dashboard">
              回會員中心
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

