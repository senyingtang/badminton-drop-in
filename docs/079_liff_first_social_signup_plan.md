# LIFF 優先社群報名方案（079）

## 1. 為什麼會看到 LINE 官方 Web 的 Email／密碼登入頁？

**無法 100% 禁止** LINE 官方在 Web Login 流程中顯示 Email／密碼或 QR Code 登入畫面。常見原因包括：

1. 使用者**不在 LINE App 內**開啟連結（一般瀏覽器、社群 App 內建瀏覽器）。
2. 裝置**未安裝 LINE**，或 LINE 未登入。
3. 外部瀏覽器**沒有有效的 LINE session**，OAuth 只能走 Web 流程。
4. **LIFF 未建立／未設定** Endpoint、或 `NEXT_PUBLIC_LINE_LIFF_ID` 未填，只能 fallback 到 Web LINE Login（`/api/auth/line/start`）。
5. LINE 端政策與帳號狀態（例如需重新同意 scope）仍可能顯示官方頁。

**結論：** 可透過 **LIFF／LINE App 優先入口** 大幅降低使用者先看到 Email 登入頁的機率，但無法保證完全不出現。

---

## 2. Web LINE Login 與 LIFF 的差異（簡述）

| 項目 | Web LINE Login（現有 `/api/auth/line/start`） | LIFF |
|------|-----------------------------------------------|------|
| 入口 | 瀏覽器導向 `access.line.me` OAuth | 多由 `liff.line.me/{LIFF_ID}` 在 LINE 內開啟 |
| 使用者情境 | 易落在一般 Web，較常看到官方 Email／QR 登入 | 在 LINE App 內較容易沿用 LINE 身分，體驗較貼近「一鍵授權」 |
| 本站實作 | `code` → `/api/auth/line/callback` → Supabase session（不變） | 本方案 **MVP**：`liff.login` 完成後仍導向 **`/api/auth/line/start`**，沿用既有 OAuth，不新增 idToken 驗證 API |

---

## 3. LIFF 優先社群報名連結格式

### 入口（建議貼在社群／臨打列表）

- 相對路徑：`/liff-entry?returnTo=/s/{share_signup_code}`
- 完整網址範例：`https://{您的網域}/liff-entry?returnTo=/s/ABC12345`
- 可選推薦碼：`&ref={referralCode}`（會帶入 Web LINE Login 的 `referralCode` 參數，格式與既有驗證一致）

### `returnTo` 安全規則

- 僅允許**站內相對路徑**（以 `/` 開頭，且禁止 `//`、`://`、`\`、`@` 等）。
- 非法或缺漏時，入口頁會改導 **`/member-dashboard/dropins`**（避免 open redirect）。

### LIFF 落地頁（需在 LINE Developers 設定 Endpoint）

- 路徑：**`/liff/line-login`**
- 完整 Endpoint URL 範例：`https://{您的網域}/liff/line-login`

---

## 4. LINE Developers 需設定的項目

1. **LINE Login channel**（與現有 `platform_line_integration.login_channel_id` 一致流程，不改 DB 契約）。
2. 新增 **LIFF App**（或在既有 Provider 下建立）：
   - **Size**：Full / Tall 等依產品選擇。
   - **Endpoint URL**：`https://{正式網域}/liff/line-login`（與部署網域一致；開發機請用 ngrok 等 HTTPS 測試網域）。
   - **Scope**：需涵蓋與 Web Login 相同之 `openid profile email`（與現有 `line/start` scope 對齊）。
3. **Callback URL**：仍為既有  
   `https://{網域}/api/auth/line/callback`  
   （本 MVP 最後仍走此 callback 建立 session）。
4. **LIFF URL**：記下 **LIFF ID**（或完整 `https://liff.line.me/{LIFF_ID}`）供環境變數使用。

---

## 5. 環境變數

| 變數 | 說明 |
|------|------|
| `NEXT_PUBLIC_LINE_LIFF_ID` | LIFF ID（不含 `https://liff.line.me/` 亦可，程式會組裝） |
| `NEXT_PUBLIC_LINE_LIFF_URL` | **選填**。若已為完整 LIFF 啟動網址（例如 `https://liff.line.me/xxxxxxxx`），優先使用；**請勿**填成本站 `/liff/line-login`（那是 Endpoint，不是 liff.line.me 啟動網址） |

未設定上述變數時：`/liff-entry` 會顯示說明並 fallback 到 **`/api/auth/line/start`**（Web LINE Login）。

---

## 6. 測試案例（建議）

| 案例 | 預期 |
|------|------|
| A. 已設定 LIFF | 開啟 `/liff-entry?returnTo=/s/TESTCODE` → 導向 `liff.line.me` → 進入 `/liff/line-login` → `liff.login` 後 → `/api/auth/line/start` → callback → 回到 `/s/TESTCODE` |
| B. 未設定 LIFF | 同上入口 → 顯示 Web 說明 → 手動「繼續使用 Web LINE Login」→ `/api/auth/line/start?...` |
| C. `returnTo=https://evil.com` | 導向 `/member-dashboard/dropins`（或後續改為其他站內安全頁） |
| D. Dropins | 主按鈕「LINE App 快速報名」→ `/liff-entry?...`；複製為完整 `origin + /liff-entry?...`；仍保留「一般報名頁」→ `/s/...` |
| E. 既有 auth | `/login`、`/api/auth/line/start`、`/api/auth/line/callback`、`/s/[code]` 行為不改核心邏輯 |

---

## 7. Fallback 行為摘要

1. **無 LIFF env**：`/liff-entry` 不跳轉 liff.line.me，改顯示文案並連結 **`/api/auth/line/start`**。
2. **有 LIFF env 但 LIFF SDK／初始化失敗**：`/liff/line-login` 顯示錯誤與手動 **Web LINE Login** 連結。
3. **非法 `returnTo`**：改為站內 **`/member-dashboard/dropins`**（`safeInternalReturnPath`）。

---

## 8. 程式入口對照

| 路徑 | 用途 |
|------|------|
| `/liff-entry` | 驗證 `returnTo`／`ref`，有 LIFF 則 `location.replace` 至 liff.line.me |
| `/liff/line-login` | 載入 LIFF SDK → `init` → 未登入則 `login` → 已登入則導向 `/api/auth/line/start` |

---

## 9. 盤點：現有 LINE Login（未改行為）

- **`GET /api/auth/line/start`**：讀 `platform_line_integration` 的 `login_channel_id` / `login_channel_secret`，寫 `kb_line_oauth` cookie，導向 `https://access.line.me/oauth2/v2.1/authorize`，scope `openid profile email`，`returnTo` 與選填 `referralCode`。
- **`GET /api/auth/line/callback`**：驗證 state、換 token、建立／綁定 Supabase 使用者；`safeReturnTo` 僅允許站內路徑（與本檔 `liff-entry` 的 fallback 規則分開）。
- **環境變數**：程式碼庫內先前**無** `LIFF` 相關變數；臨打／報名連結先前多為 **Web** `/api/auth/line/start` 或站內 `/login`。

本方案在 **不取代** 上述流程的前提下，增加 **LIFF 優先外殼** 與 **臨打列表主按鈕** 導向。
