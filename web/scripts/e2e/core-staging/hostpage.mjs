import { chromium, W, load, settle } from './lib.mjs'
export async function hostPage(b, viewport = { width: 1400, height: 1000 }) {
  const st = load()
  const ctx = await b.newContext({ storageState: './host-state.json', locale: 'zh-TW', timezoneId: 'Asia/Taipei', viewport })
  const page = await ctx.newPage()
  page.on('dialog', (d) => { console.log('  DIALOG:', d.message().slice(0, 100)); d.accept() })
  page.errs = []
  page.on('response', (r) => { if (r.status() >= 400) page.errs.push(`${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '')}`) })
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.errs.push('console: ' + m.text().slice(0, 200)) })
  await page.goto(`${W}/sessions/${st.sessionId}`); await settle(page, 3000)
  return { ctx, page, st }
}
