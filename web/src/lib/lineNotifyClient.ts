/**
 * 瀏覽器端觸發報名 / 候補轉正推播。
 *
 * 不可 fire-and-forget 後立刻 reload / 導頁：瀏覽器會中斷尚未完成的請求，
 * Cloudflare Worker 在用戶端斷線時會取消該請求的處理（推播不會送出）。
 * 因此：keepalive（頁面卸載後瀏覽器仍會送完）＋ 最多等待 waitMs 再繼續。
 * 不 throw；推播結果由伺服端寫入 public_signup_error_logs（flow = line_notify）。
 */
export async function triggerLineNotify(
  path: '/api/line/notify-signup' | '/api/line/notify-waitlist-promotion',
  sessionParticipantIds: string[],
  waitMs = 5000,
): Promise<void> {
  const ids = sessionParticipantIds.map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return
  const calls = ids.map((id) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ sessionParticipantId: id }),
    })
      .then(() => undefined)
      .catch(() => undefined),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
  })
  await Promise.race([Promise.all(calls).then(() => undefined), timeout])
  if (timer) clearTimeout(timer)
}
