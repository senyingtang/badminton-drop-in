# Cloudflare Workers：Preview 部署、Secrets、回滾與正式切換 Runbook

所有指令在 `web/` 目錄執行。**本階段不執行正式切換。**

## 1. 指令

| 用途 | 指令 |
|------|------|
| 原 Next.js 開發 / 建置（不變） | `npm run dev` / `npm run build` / `npm run start` |
| vinext 開發（:3001） | `npm run dev:vinext` |
| vinext 建置 Worker | `npm run build:vinext` |
| 本機以 workerd 預覽 | `npm run start:vinext`（只綁 `localhost`/IPv6，用 `http://localhost:4173`） |
| 驗證 Cloudflare 帳號 | `npm run cf:verify`（= `scripts/cloudflare/cf-account-guard.ps1`） |
| 部署 Preview Worker | `npm run deploy:vinext`（= `scripts/cloudflare/cf-deploy-preview.ps1`，預設 dry-run） |
| Workers 型別檢查 | `npx tsc -p tsconfig.cloudflare.json --noEmit` |

設定檔：`cloudflare.config.ts`（Worker 名稱 `badminton-drop-in-preview`；vinext 不使用 `wrangler.jsonc`，**不要執行 `npx wrangler setup`**，那會改裝 OpenNext）。

## 2. 環境變數 / Secrets 清單

> `NEXT_PUBLIC_*` 在**建置時**內嵌到 bundle：建 Preview 時要用 Preview 的值建置，不能事後改。

| 名稱 | 類型 | 何時需要 | 備註 |
|------|------|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | build-time | 必填 | Preview 應指向**非正式** Supabase（見 §3） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build-time | 必填 | |
| `NEXT_PUBLIC_LINE_LIFF_ID` | build-time | LIFF | Preview 應用測試 LIFF App |
| `NEXT_PUBLIC_LINE_LIFF_URL` | build-time | LIFF | |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | LINE 登入、付款、管理 API | 沒有隔離 DB 前，Preview **不要設定** |
| `AI_API_KEY`、`AI_OPENAI_API_KEY`、`AI_GROQ_API_KEY`、`AI_DEEPSEEK_API_KEY`、`AI_MISTRAL_API_KEY`、`AI_OPENROUTER_API_KEY` | **secret** | AI 功能 | 選填 |
| `AI_PROVIDER`、`AI_MODEL`、`AI_API_BASE_URL`、`AI_CHAT_COMPLETIONS_PATH`、`AI_SYSTEM_PROMPT_DEFAULT`、`AI_TIMEOUT_MS`、`AI_OLLAMA_BASE_URL` | var | AI 功能 | 選填 |
| `GIT_COMMIT_SHA` | var | `/api/version` | 取代 `VERCEL_GIT_COMMIT_SHA` |

**不在 env 的憑證**：LINE Login / Messaging token 存在 `platform_line_integration`；ECPay merchant / HashKey / notify URL 存在 `payment_provider` 表。→ 只要 Preview 連到正式 DB 並有 service role，就能**發正式 LINE 推播、建立正式金流訂單**。

設定 secret（只在 Cloudflare，不進 repo；一律經過帳號防呆）：

```powershell
./scripts/cloudflare/cf-account-guard.ps1 -IgnoreEnvToken -CfArgs workers,secrets,update,--help   # 先查參數
```

## 2.5 Cloudflare 帳號鎖（M1.2）

- 唯一允許帳號：`feb96af4be0e308c286c3fd8d50e1941`（senyingtang2025@gmail.com）。寫在 `cloudflare.config.ts` 的 `accountId` 與 `scripts/cloudflare/cf-account-guard.ps1`，兩邊必須一致。
- 拒絕帳號：`e3193fd95e1cbec497aed80bcc07b191`（Ryan@hermose.com's Account）。
- 本機 Windows **User 層級**已設定 `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID=e3193…`（屬於 Ryan 帳號）。`cf` 的優先序是 env token > profile > OAuth，env account > `cloudflare.config.ts`，所以不防呆時會部署到 Ryan 帳號。
- 防呆腳本**不修改** User / Machine 變數：
  - 預設：偵測到不符的 env account / token → 直接 FAIL（exit 2）。
  - `-IgnoreEnvToken`：只在該 PowerShell 程序內移除繼承的 token / account，改用 `cf` 自己的 OAuth 登入；結束後還原。
  - 專案 `.env*` / `.dev.vars*` 內出現 Cloudflare 憑證 → FAIL。
  - 最後以 `cf auth whoami` 確認「實際生效」的身分可存取允許帳號，並強制 `CLOUDFLARE_ACCOUNT_ID` 為允許帳號。
- 注意：`cf` 與 Wrangler 的 OAuth 登入**不共用**。第一次要在 `web/` 執行 `npx cf auth login`（以 senyingtang2025@gmail.com 登入）。
- 部署腳本另外檢查：不在 `main`/`master`、Worker 名稱必須是 `badminton-drop-in-preview`、不得宣告 routes / 自訂網域、建置不得指向正式 Supabase（除非 `-AllowProductionSupabase`）、預設 `--dry-run`。

本機 workerd 用的 secret 放 `web/.dev.vars`（已加入 `.gitignore`），格式見 `web/.dev.vars.example`。

## 3. Cloudflare Preview 測試方案

**原則：Preview 不得發正式 LINE 通知、付款或分潤事件。**

建議（擇一，需要你決定）：

- **A（建議）**：建一個 Staging Supabase 專案（從 migrations 建 schema + 測試資料），用測試 LINE Channel / LIFF、ECPay 測試商店（`environment = stage`）。Preview 全部指向 Staging。可完整跑 Part E。
- **B（只讀 smoke）**：Preview 連正式 Supabase，但**不設定 `SUPABASE_SERVICE_ROLE_KEY`**。LINE 登入 / 付款 / 管理 API 會回 `SERVICE_ROLE_NOT_CONFIGURED`，只能測公開頁、Email 登入、RLS 範圍內的讀寫。⚠️ 已登入使用者仍可透過 RLS 寫入正式資料（例如報名），只能用測試帳號、測試場次。

Preview 部署步驟（方案 A）：

```powershell
cd D:\project\badminton\web
git switch feat/cloudflare-workers-m0-m1
# 1) cf 自己的 OAuth 登入（一次；在乾淨的程序環境下執行，避免被 User 層級 token 蓋掉）
powershell -NoProfile -Command "Remove-Item Env:CLOUDFLARE_API_TOKEN,Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue; npx cf auth login"
# 2) 驗證帳號（應顯示 PASS 與 feb96af4…）
./scripts/cloudflare/cf-account-guard.ps1 -IgnoreEnvToken
# 3) 準備 repo 外的 build env 檔（只放 NEXT_PUBLIC_*，例：D:\secrets\badminton-preview.env）
# 4) Dry run → 確認後再實際部署到 *.workers.dev（不綁正式網域）
./scripts/cloudflare/cf-deploy-preview.ps1 -IgnoreEnvToken -EnvFile D:\secrets\badminton-preview.env
./scripts/cloudflare/cf-deploy-preview.ps1 -IgnoreEnvToken -EnvFile D:\secrets\badminton-preview.env -Deploy
```

Preview 網域需加入（**只加，不改正式項目**）：

- Staging Supabase → Auth → URL Configuration → Redirect URLs：`https://badminton-drop-in-preview.<subdomain>.workers.dev/auth/callback**`
- 測試 LINE Login Channel → Callback URL：`https://…workers.dev/api/auth/line/callback`
- 測試 LIFF Endpoint：`https://…workers.dev/liff-entry`

⚠️ 若 Supabase Redirect URLs 沒加 Preview 網域，magiclink 會退回 Site URL（正式站），LINE 登入會在正式站完成。

## 4. 回滾

- Preview：`npx wrangler deployments list --name badminton-drop-in-preview` → `npx wrangler rollback <version-id> --name badminton-drop-in-preview`；或直接 `npx wrangler delete --name badminton-drop-in-preview`。
- 程式碼：本 branch 未合併前 `main` 不受影響；Vercel 仍從 `main` 部署。
- 正式切換後的回滾：見 §5 第 8 點。

## 5. 正式切換 Checklist（本階段不執行）

1. **正式網域**：決定新網域或沿用；在 Cloudflare 建 Worker Custom Domain。保留 `badminton-drop-in.vercel.app` 作回滾目標。
2. **DNS / TLS**：網域 DNS 交給 Cloudflare（或 CNAME）；確認憑證簽發完成後才切流量；先把 TTL 降到 300。
3. **Supabase Auth**：Site URL 改新網域；Redirect URLs 同時保留新舊網域，至少維持一個回滾週期。
4. **LINE**：Login Channel Callback URL **新增**新網域（舊的先保留）；LIFF Endpoint URL 切到新網域；Messaging Webhook URL 切到新網域（只能一個 → 切換當下確認）。
5. **ECPay**：`payment_provider.notify_url / subscription_notify_url / return_url` 改新網域；ECPay 後台定期定額設定同步。
6. **Server Secrets**：`SUPABASE_SERVICE_ROLE_KEY`、AI keys 以 `wrangler secret put` 設定；用正式值重新 `build:vinext`。
7. **避免新舊環境重複處理付款**：
   - notify URL 在 DB，同一時間只會打一個網域。切換後舊 Vercel 仍可能收到「切換前已建立的訂單」的 notify，處理邏輯以 `kb_payment_orders.status` 冪等 + 分潤 partial unique index（076）保護，兩邊同時處理同一筆不會重複入帳，但要觀察。
   - **切換前必須先修 ECPay `CheckMacValue` 驗證**（見 M0-M1 報告 §5）。
   - 切換後把 Vercel 的 `SUPABASE_SERVICE_ROLE_KEY` 移除或停用 Vercel 上的 notify / webhook 路由，避免兩邊都能寫。
8. **監控與回滾**：開 Workers Logs / Observability；監看 5xx、Supabase Auth 429 / `refresh_token_already_used`、ECPay notify 成功率、LINE webhook 失敗。回滾 = DNS 指回 Vercel + 把 DB 中的 notify URL、LINE callback / LIFF / webhook 改回舊網域。
9. **舊連結**：已分享的 `https://badminton-drop-in.vercel.app/s/<code>`、`/signup/<id>`、LINE Rich Menu、LIFF 連結。建議在 Vercel 上保留一個 redirect-only 部署（`vercel.json` 308 到新網域，保留 path + query），而不是刪除 Vercel 專案。Rich Menu 連結需重新上傳。
