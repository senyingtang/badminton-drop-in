/**
 * LIFF「首次開啟」時，LINE 會把 liff.line.me/{id}?returnTo=… 的參數包進 liff.state 再交給 Endpoint：
 *   https://<endpoint>/liff/line-login?liff.state=%3FreturnTo%3D%252Fs%252FABC
 * liff.init() 之後 SDK 才會把網址換成 ?returnTo=…（secondary redirect）。
 * 頁面若在 init 之前就讀 returnTo，會讀不到而落到預設頁（正式站紀錄：LIFF_RETURN_TO_LOST）。
 * 這裡先讀直接參數，沒有時再從 liff.state 解析。只解析，不判斷安全性（呼叫端仍需檢查站內路徑）。
 */
export function readLiffParam(sp: URLSearchParams, name: string): string | null {
  const direct = sp.get(name)
  if (direct && direct.trim()) return direct.trim()
  const state = sp.get('liff.state')
  if (!state) return null
  const q = state.indexOf('?')
  if (q < 0) return null
  // liff.state 本身已被 URLSearchParams 解碼一次；內層 query 再交給 URLSearchParams 解碼
  const inner = new URLSearchParams(state.slice(q + 1).split('#')[0])
  const v = inner.get(name)
  return v && v.trim() ? v.trim() : null
}
