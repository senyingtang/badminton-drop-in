# M0–M1：Vercel → Cloudflare Workers（vinext）相容性與本機測試報告

- 日期：2026-11-07
- Branch：`feat/cloudflare-workers-m0-m1`（從 `main` @ `69dfa6a` 分出）
- 範圍：盤點、相容性、本機建置與 smoke test。**未部署任何環境、未改正式網域、未改 Supabase / LINE / ECPay 設定。**

---

## 1. 504 `MIDDLEWARE_INVOCATION_TIMEOUT` 與登入問題盤點（Part A）

> 沒有 Vercel Logs 存取權（本機無 Vercel CLI、Vercel MCP 未授權），**無法對照 504 Request ID**。以下為程式碼與實測證據推論，不是已證實的根因。
> **遷移到 Cloudflare 不會自動解決以下問題**：middleware 照樣在 Worker 內等待 Supabase；只是 Workers 沒有 Vercel 的 middleware 時限，症狀會從「504」變成「頁面一直轉圈」。

### 1.1 middleware 實際邏輯（`web/src/middleware.ts`）

- matcher 涵蓋除 `_next/static`、`_next/image`、`favicon.ico`、`api/`、圖片副檔名外的**所有頁面請求**（含 RSC prefetch）。
- 每個請求：`supabase.auth.getUser()`；已登入且進入管理路徑時再查 `app_user_profiles.primary_role`；`/login`、`/register` 再查一次（原本同請求最多 2 次 profile 查詢）。
- Next 16 已將 `middleware.ts` 標為 deprecated（改名 `proxy.ts`，預設 Node runtime）。目前在 Vercel 上仍以 **Edge runtime** 執行。

### 1.2 證據

| # | 觀察 | 證據 |
|---|------|------|
| E1 | **無 Cookie 時 middleware 不打網路**：`getUser()` 在沒有 session 時直接回 `AuthSessionMissingError`。 | 本機 `next start` / Worker 無 Cookie 請求 middleware 約 3–8 ms。 |
| E2 | **有 Cookie（一般 Chrome）時每個頁面請求都會呼叫 Supabase Auth**，access token 過期還會先打 refresh。 | 帶過期 session Cookie 重放：100–700 ms；從台灣量 Supabase `/auth/v1/health` TTFB ≈ 190 ms。 |
| E3 | **原 middleware 對 Supabase 呼叫沒有逾時**。Supabase 慢 / 被 rate-limit / 專案喚醒時，middleware 會一直等，直到 Vercel 中止 → 504。 | 程式碼：`createServerClient` 未設定 `global.fetch`，無 AbortSignal。 |
| E4 | **導向回應會丟失刷新後的 Cookie**：`NextResponse.redirect()` 是全新回應，`@supabase/ssr` 寫在 `supabaseResponse` 上的 Set-Cookie 不會帶出。 | 修正前：帶過期 Cookie 請求 `/dashboard` → 307 **無** `Set-Cookie`；`/login`（非導向）有。修正後所有導向都帶 `Set-Cookie`。 |
| E5 | **profile 查詢失敗時團主會被導去 `/member-dashboard`**：錯誤時 `profile=null` → 被當成非管理角色。 | 程式碼：`if (!isManagementRole && isManagementPath) redirect('/member-dashboard')`，未檢查 `error`。 |
| E6 | `/` 一律 `redirect('/dashboard')`；登入預設 `returnTo=/dashboard`；非管理角色再被導到 `/member-dashboard`。 | 這是「跳到 /member-dashboard」的正常路徑；E5 是異常路徑。 |
| E7 | Vercel 函式跑在 **iad1（美東）**，middleware 跑在 hkg1 edge。 | 正式站回應標頭 `X-Vercel-Id: hkg1::iad1::…`。每個 SSR / API 都是台灣→香港→美東→Supabase。 |
| E8 | 用戶端 `useUser()` 呼叫 `getUser()` 無逾時 → 畫面可能永遠停在「載入中...」。 | `web/src/hooks/useUser.ts`（修正前）。 |

### 1.3 為什麼「無痕可以、一般 Chrome 不行」——最可能的機制

1. 無痕沒有 `sb-*-auth-token` Cookie → middleware 不打 Supabase（E1）→ 不會 504。
2. 一般 Chrome 有舊 Cookie → 每個頁面 + 每個 `<Link>` prefetch 都打 Supabase Auth（E2）；多個並行請求同時用同一顆過期 token refresh。
3. 導向回應不帶新 Cookie（E4）→ 伺服端已輪替 refresh token、瀏覽器還是舊的 → 下一請求再 refresh → 超過 Supabase reuse interval 後被判定重用、session 被撤銷 → 「無法登入」或被踢出。
4. 任一次 Supabase 呼叫變慢且無逾時（E3）→ 504。

**驗證方法（需要 Vercel Logs）**：篩選 504 請求，看是否都帶 `sb-` Cookie、是否集中在 token 過期時間點、是否對應 Supabase Auth log 的 `refresh_token_already_used` / 429。

### 1.4 其他項目

| 項目 | 結果 |
|------|------|
| `/login` | 靜態頁；已登入者被 middleware 依角色導走（不採用 `returnTo`）。 |
| `/dashboard`、`/sessions/[id]` | 管理路徑；未登入 → `/login?returnTo=…`；非管理角色 → `/member-dashboard`。 |
| `/member-dashboard` | 需登入，不檢查角色。 |
| LINE Login | `/api/auth/line/start` → LINE → `/api/auth/line/callback`（service role 建帳號、產生 magiclink）→ `/auth/callback`（瀏覽器端 `setSession`）。`redirect_uri` 與 magiclink `redirectTo` **都由請求 origin 推導**。 |
| LIFF | `/liff-entry`、`/liff/line-login`，公開路徑。 |
| 無限等待 | 原 middleware（E3）、用戶端 `useUser`（E8）。 |
| 重複刷新 / 重複導向 | E4 會造成重複 refresh；未發現 A→B→A 的導向迴圈。 |
| 登出 | 後台 Header 有登出；**會員區（`/member-dashboard`）沒有登出按鈕**（會員區不渲染 Header，`/settings` 又是管理路徑）。原登出若 `signOut()` 網路失敗不會離開頁面。 |
| Service Worker | 無（`public/` 無 sw、程式碼無 `navigator.serviceWorker`）。 |
| 快取 | 無 `vercel.json`；`/login` 等為靜態頁（`X-Vercel-Cache: HIT`），不含使用者資料。 |

### 1.5 本 branch 已做的 Auth 修正（Part D，最小變更）

1. `middleware.ts`：所有 Supabase 呼叫 4 秒逾時（fail-closed：逾時 = 未驗證）。
2. `middleware.ts`：所有導向帶上 `@supabase/ssr` 的 Set-Cookie（E4）。
3. `middleware.ts`：profile 查詢錯誤時，管理頁回 `503 + Retry-After`，**不放行、也不誤導到會員中心**（E5）；同請求只查一次 profile。
4. `useUser.ts` + `(protected)/layout.tsx`：8 秒逾時，顯示「重新整理」而非無限轉圈；逾時不自動導向登入頁（避免循環），也**不視為已登入**。
5. 會員區新增登出按鈕；登出改為 `signOut()` 後整頁 `location.assign('/login')`（即使 signOut 失敗也離開）。

未改：RLS、Schema、RPC、排組演算法、付款 / 分潤、LINE / ECPay 設定。

---

## 2. Cloudflare 相容性（Part B）

### 2.1 `npx vinext check`

```
Imports: 4/4 fully supported (next/link, next/navigation, next/server, next/headers)
Config:  reactCompiler — ignored; enable with vinext({ react: { compiler: true } })
Project: App Router ✓, 38 pages, 4 layouts, 51 route handlers, src/middleware.ts ✓ (deprecated in Next 16)
Issue:   __dirname / __filename → 只在 tools/*.mjs（本機 CLI 腳本，不進 Worker bundle）
Overall: 86% compatible (9 supported, 1 partial, 1 issue)
```

結論：**無關鍵不相容，不需要 OpenNext**。

### 2.2 盤點

| 項目 | 狀態 | 說明 |
|------|------|------|
| Next.js 16.2.1 / App Router | ✅ | vinext 支援。 |
| React | ⚠️ | `vinext init` 把 react / react-dom 由 19.2.4 升到 ^19.3.1（`react-server-dom-webpack` 需同版）。`next build` 已驗證通過。 |
| React Compiler | ⚠️ | vinext 需額外套件 `oxc-transform-react`，本次未安裝 → Worker 版暫不啟用（只影響 memo 效能，不影響行為）。 |
| Node-only 依賴 | ✅ | 僅 `node:crypto.timingSafeEqual`（LINE webhook）與 `Buffer`（LINE callback / webhook）；`nodejs_compat` 已啟用。 |
| Middleware | ✅ | Worker 內執行；行為與 `next start` 一致（見 §4）。 |
| Route Handlers（51） | ✅ | `export const runtime = 'nodejs'` 會被 vinext 忽略（全部跑在 Worker）。 |
| Server Actions | — | 未使用。 |
| Cookies / `next/headers` | ✅ | 已驗證 Set-Cookie 行為一致。 |
| Supabase SDK | ✅ | fetch-based；Auth / PostgREST 實測可用。 |
| LINE OAuth | ⚠️ | 程式相容；但 callback URL 由 origin 推導，**Preview 網域須另行加入 LINE Channel 才能測**（屬設定變更，需你決定）。 |
| ECPay Webhook | ⚠️ | 程式相容（純 URLSearchParams）。**另見 §5 安全發現**。notify / return URL 存在 DB（`payment_provider`），不在 env。 |
| AI API | ✅ | fetch-based，`AI_TIMEOUT_MS` 已有逾時。 |
| Image Optimization | ✅ | 只有 1 處 `next/image`（svg）；選 `--image-optimization=none`（`/_next/image` 導回原檔）。 |
| ISR / revalidate / `use cache` | — | 未使用 → `--cdn-cache=none --data-cache=none`。 |
| Vercel 專屬 | ⚠️ | 無 `@vercel/*` 套件；`next.config.ts` 的 `VERCEL==='1'` 建置檢查在 CF 不會觸發；`/api/version` 讀 `VERCEL_*`（CF 上改用 `GIT_COMMIT_SHA`）。 |
| `tsconfig` | ⚠️ | 官方建議把 `.cloudflare/types` 加入 `tsconfig.json`，**實測會讓 `next build` 型別檢查失敗**（Workers 型別把 `Response.json()` 改成 `unknown`）→ 改放 `tsconfig.cloudflare.json`。 |
| 靜態資源 | ✅ | `_next/static/*` 由 Workers Assets 直接回應（`runWorkerFirst` 排除）。 |

---

## 3. 本機建置結果

| 指令 | 結果 |
|------|------|
| `npx eslint` | 0 errors / 52 warnings（修改前 53，皆既有警告） |
| `npx next build`（修改後） | ✅ 通過 |
| `npm run build:vinext` | ✅ 通過，輸出 `.cloudflare/output/v0/workers/default`（約 15 MB 含 sourcemap） |
| `npx tsc --noEmit` | 既有錯誤（`.next/types` 舊檔、`sessions/[id]/page.tsx`、`OperationReportModal.tsx`）；`next build` 內建型別檢查通過 |

---

## 4. 本機 smoke test（`next start` :3000 vs Worker `vite preview` :4173）

19 條路徑（`/`、`/login`、`/register`、`/dashboard`、`/member-dashboard`、`/sessions`、`/sessions/[id]`、`/s/[code]`、`/signup/[id]`、`/liff-entry`、`/liff/line-login`、`/auth/callback`、`/pricing`、`/api/version`、`/api/auth/whoami`、`/api/ai/status`、`/favicon.ico`、`/shuttles/*.svg`、`/_next/image`）：

- **無 Cookie：狀態碼與導向目標兩邊完全一致。**
- **過期 / 無效 Session Cookie**：兩邊都導回 `/login?returnTo=…`，並帶 `Set-Cookie` 清除（修正前導向不帶）。
- 本機 `.env.local` 沒有 `SUPABASE_SERVICE_ROLE_KEY`，因此 service-role 路由（LINE、付款、管理）不會寫入正式 DB、不會推播。

> 這只是 HTTP 層 smoke test，**不代表功能通過**。

---

## 5. 重要安全發現（未修，需另開任務）

> **M1.2 更新（2026-11-07）**：已在 branch 上停用所有線上金流入口（`src/lib/payments/paymentGate.ts`）：兩個 ECPay notify 一律回 `503 0|PAYMENTS_DISABLED` 且不讀 body、不碰 DB；`/api/payments/topup/create` 回 `503 PAYMENTS_DISABLED`，不建立訂單；儲值頁按鈕停用。實際攻擊鏈比原先描述更直接：`topup/create` 會**回傳** `merchant_trade_no`，攻擊者不需要猜。
> **仍待處理的 P0**：`kb_wallet_debit_cents`（`docs/048_…sql`）是 `SECURITY DEFINER`、函式內沒有身分檢查，migration 也沒有 `REVOKE`。Supabase 預設 public schema 函式可由 `anon` / `authenticated` 執行 → 可能任何人都能扣任意帳戶的錢包。需在 SQL Editor 執行 `select has_function_privilege('anon','public.kb_wallet_debit_cents(uuid,bigint,uuid,public.kb_wallet_txn_reason,text,uuid,text,jsonb)','execute'), has_function_privilege('authenticated', …同上…, 'execute');` 確認；修正需要 `REVOKE`（屬權限 / schema 變更，依禁止事項未執行）。
> **M1.3 更新（2026-11-07）**：App 端已暫停錢包、儲值與訂閱（`src/lib/billing/billingGate.ts`），開放報名改走不計費流程（`src/lib/billing/openRegistration.ts`）。上述 P0 的 REVOKE／GRANT 方案、rollback 與驗證 SQL 放在 `docs/proposals/092_billing_pause_rpc_lockdown/`（**尚未執行，需核准**），依賴盤點、執行順序與待決事項見該資料夾的 README.md。

**🔴 ECPay notify 未驗證 `CheckMacValue`**：`web/src/lib/payments/ecpayPaymentNotify.ts` 只用 `MerchantTradeNo` 查訂單、比對金額、看 `RtnCode === '1'` 就標記為已付款並觸發分潤。任何人只要知道（或猜到）一筆 pending 訂單的 `MerchantTradeNo` 和金額，POST 到 `/api/payments/ecpay/notify` 或 `/api/subscriptions/ecpay/notify` 就能偽造付款成功。這與 Vercel / Cloudflare 無關，**正式站目前就有此風險**。依禁止事項（不改付款邏輯）本次未修改，建議優先處理。

---

## 6. 尚未通過 / 尚未執行的測試

需要測試帳號與隔離環境，本機無法完成：

- 已登入首頁、無重複導向、團主權限、會員越權（Part D 2–5）
- LINE Login / LIFF 實機（需 Preview callback URL）
- 登出後 SSR Cookie 失效（程式已改，未實機驗證）
- Part E 全部功能：自己 / 多人代報名、候補轉正、LINE 通知、場次 CRUD、繳費狀態、LINE 聯絡 / 廣播、排組建立 / 鎖定 / 結束、Queue、營運報表、儲值 / 訂閱 / 付款回呼、分潤冪等
- Part F 效能：需要部署到 Cloudflare 後，從台灣網路量測（冷 / 暖 / 未登入 / 已登入、手機 Chrome / Safari）

Vercel 正式站基準（2026-11-07，台灣有線網路，未登入，各 3 次）：

| 路徑 | TTFB |
|------|------|
| `/login`（靜態，cache HIT） | 0.17–0.94 s |
| `/s/[code]`（SSR，iad1） | 0.42–0.51 s |
| `/dashboard`（middleware 307） | 0.16–0.29 s |
| `/api/version`（iad1） | 0.43–0.83 s |
