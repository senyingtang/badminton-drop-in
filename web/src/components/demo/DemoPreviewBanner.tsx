import { DEMO_LOGIN_EMAIL, DEMO_LOGIN_PASSWORD, DEMO_SHARE_CODE, isDemoPreview } from '@/lib/demo/demoPreview'

/** 測試預覽標示：只在 Demo Preview 建置中顯示，正式建置會回傳 null。 */
export default function DemoPreviewBanner() {
  if (!isDemoPreview()) return null
  return (
    <div
      role="status"
      data-demo-preview="1"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: '#b45309',
        color: '#fff',
        padding: '6px 12px',
        fontSize: 13,
        lineHeight: 1.5,
        textAlign: 'center',
      }}
    >
      <strong>測試預覽（Demo）</strong>：畫面均為假資料，不會報名、扣款、付款或發送 LINE 通知。
      示範帳號 {DEMO_LOGIN_EMAIL} / {DEMO_LOGIN_PASSWORD}，示範報名頁{' '}
      <a href={`/s/${DEMO_SHARE_CODE}`} style={{ color: '#fff', textDecoration: 'underline' }}>
        /s/{DEMO_SHARE_CODE}
      </a>
    </div>
  )
}
