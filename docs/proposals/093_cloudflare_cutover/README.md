# 093 Cloudflare 正式遷移（M3）：保留原 Supabase 全部資料

> 狀態：**準備中**。本目錄所有 SQL 都沒有在任何 Supabase 執行過。
> 正式 Supabase 不重建、不清空、不搬家；Cloudflare 只取代 Vercel 的「App 執行環境」，資料庫維持同一個。

## 1. 正式 Supabase 識別與資料保護

| 項目 | 值 / 做法 |
|---|---|
| 正式專案 ref | `ngudidpitcfyzmbphlgt`（`web/.env.production`、`.env.local` 皆指向它） |
| 專案網址 | `https://ngudidpitcfyzmbphlgt.supabase.co` |
| 確認方式 | Dashboard → Project Settings → General 的 Reference ID 必須相同；00e 的 A 段顯示資料庫名稱與時間 |
| 保護機制 | 所有 Preview / Staging Worker 的部署腳本都會**拒絕**含此 ref 的建置（已實測） |

### 1.1 唯讀核對 SQL：`00e_data_inventory_readonly.sql`

一個 SELECT，SQL Editor 直接執行，匯出 CSV。只輸出數量、金額合計與 md5 指紋，不輸出個資。

| 段 | 內容 |
|---|---|
| A | 資料庫名稱、版本、時間 |
| B | 會員：auth.users、profiles（啟用 / 停權 / 已刪除 / 各角色）、players |
| C / C2 | 場次總數、各狀態、時間範圍、前後 30 天；**前後 14 天逐場**（開始時間、狀態、標題前 20 字、正選 / 候補人數） |
| D | 報名：各狀態、移除、候補、遞補紀錄 |
| E | 排組：rounds、matches、有結果的場次、隊伍、比分提交、場地 |
| F | 錢包：kb_wallets 筆數 / 餘額合計 / 負餘額、交易筆數 / 合計、各類型、**餘額 ≠ 最後一筆交易 balance_after 的數量**、舊版 wallet_accounts |
| G | 營運報表：筆數、實收 / 毛利 / 淨利、球 / 場地 / 其他成本（分）、已繳費標記 |
| H | 付款 / 分潤 / 訂閱：各狀態筆數與金額、最後一筆 paid_at（付款停用期間不應增加） |
| Z | 7 張核心表的內容指紋（任何寫入都會改變） |

用法：
1. **任何正式 SQL 之前與之後**各跑一次。PGlite 實測：套用 01d + 01 + 01b + 01c + 01e 前後，A–Z **完全相同**（`staging-test/test-m3.mjs`）。
   正式站若期間有使用者報名，Z 段與 D 段會依新增筆數變動，其他段落應不變。
2. **切換 Cloudflare 前與後**各跑一次，比對方式相同。

### 1.2 備份與復原（執行任何正式 SQL 前必須完成）

Supabase 自動備份依方案而定：
- **Free 方案**：沒有可下載的自動備份。
- **Pro 方案**：有 7 天每日備份，PITR 需另購。

請在 Dashboard → Database → Backups 確認目前方案。無論方案為何，都先做一次**手動邏輯備份**，存在 repo 以外：

```powershell
# 在 D:\project\badminton\web 執行。資料庫密碼只在互動提示輸入，不寫入檔案或 repo。
# 連線字串取自 Dashboard → Connect → Session pooler（含 ngudidpitcfyzmbphlgt）
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
New-Item -ItemType Directory -Force "D:\project\secrets\badminton-backup-$stamp" | Out-Null
npx supabase db dump --db-url "postgresql://postgres.ngudidpitcfyzmbphlgt@<pooler-host>:5432/postgres" -f "D:\project\secrets\badminton-backup-$stamp\schema.sql"
npx supabase db dump --db-url "postgresql://postgres.ngudidpitcfyzmbphlgt@<pooler-host>:5432/postgres" --data-only -f "D:\project\secrets\badminton-backup-$stamp\data.sql"
npx supabase db dump --db-url "postgresql://postgres.ngudidpitcfyzmbphlgt@<pooler-host>:5432/postgres" --role-only -f "D:\project\secrets\badminton-backup-$stamp\roles.sql"
Get-ChildItem "D:\project\secrets\badminton-backup-$stamp" | Select-Object Name, Length
```

- `--data-only` 包含 `auth` schema 的會員帳號。
- 檔案含個資，只存在本機加密磁碟或密碼管理器附件，**不進 git、不上傳雲端硬碟**。

**復原方案**

| 情境 | 做法 |
|---|---|
| 權限 SQL 有問題 | 執行對應 rollback（99a–99f），不需要動資料 |
| 資料被誤改 | Pro 方案用 Dashboard 還原每日備份；或從 `data.sql` 取出特定表，經人工核對後寫回 |
| 整個專案毀損 | 新建專案，依序執行 `roles.sql` → `schema.sql` → `data.sql`，再把 App 的 Supabase URL / key 換成新專案 |

## 2. 正式資料庫 P0 修復狀態

**00d 的正式站輸出尚未提供給我**，下表依 repo migrations 推定。收到 00d CSV 後再逐項確認。

| P0 | 修補 | 狀態 | 本機測試 |
|---|---|---|---|
| app_user_profiles 自我提升為管理員 | `01d` | 已完成，**待核准執行** | 48/48 |
| kb_organization_members 等 kb 帳務表未啟用 RLS、anon 可讀 | `01b` | 已完成，待核准 | 含於 129/129 |
| 帳務表未授權寫入（anon / authenticated 可改錢包、加入組織） | `01` | 已完成，待核准 | 含於 129/129 |
| 007 測試帳號（`admin@example.com` / `password123` 等） | **`05`（M3 新增）**：ban、隨機密碼、降為 player、停權，寫入稽核；不刪資料 | 已完成，待 00d L7 確認存在才執行 | test-m3 34/34 |
| 停權未參與授權 | **`01e`（M3 新增）**：角色判斷加上 is_active / is_deleted；停權者不能新增或修改報名。App 端停權 / 復權同步 ban / unban Auth 帳號 | 已完成，待核准 | test-m3 34/34 |

各自的回滾：01d → 99d、01 → 99b、01b / 01c → 99c、01e → 99e、05 → 99f。

**建議執行順序**（每一步前後都跑 00e；第一步前先完成 1.2 的備份）：
1. `00d` + `00e` + 備份
2. `01d`
3. `01` → `01b` → `01c`
4. `01e`
5. 若 00d L7 有測試帳號：`05`
6. `03` 驗證；再跑一次 00e，比對結果
7. **`094/01`（M8 新增，非安全性、功能修復）**：修正「⬆ 遞補下一位」trigger（`players.user_id` → `auth_user_id`）。正式 schema 與 Staging 同（M8 以唯讀欄位探測確認），推定正式站同樣失敗。回滾 `094/99`。

M7.2 / M8：092 01d / 01 / 01b / 01c / 01e 與 094/01 已在 Staging（`cwvhxkujxsurvrmjexvm`）套用並通過雲端 Auth 24/24、核心寫入 11/11。

01e 必須和新版 App 一起上線，舊版 Vercel 的停權按鈕不會 ban Auth 帳號。

**對既有場次報名的影響**（PGlite 實測，使用真實的 `self_signup_to_session_by_share_code` RPC）：
- 啟用中的球友與團主報名正常。
- 「已報名」等原有規則不變。
- service_role 不受影響。
- 只有停權或已刪除的帳號被擋（`ACCOUNT_SUSPENDED`）。

## 3A. 唯讀整合測試 Worker（M3 修正：直接沿用正式 Supabase）

使用者決策：只遷移網站主機，不搬資料庫。第一階段以**唯讀**方式讀正式 Supabase `ngudidpitcfyzmbphlgt`。

| 項目 | 值 |
|---|---|
| 網址 | https://badminton-drop-in-readonly.senyingtang2025.workers.dev |
| Worker | `badminton-drop-in-readonly`（帳號 `feb96af4be0e308c286c3fd8d50e1941`，只有 workers.dev） |
| 存取 | Basic Auth，帳號任意（例如 `preview`），密碼是 Worker secret `PREVIEW_ACCESS_PASSWORD`。密碼存在 `D:\project\secrets\badminton-readonly-preview-password.txt`（repo 外）。通過後發 12 小時的 HttpOnly 簽章 Cookie |
| service_role | **沒有設定**；程式在唯讀模式下也強制不使用；部署腳本若偵測到此 secret 會失敗 |

### 安全限制（伺服器端，不依賴前端隱藏按鈕）

1. **Worker 閘門**（`web/src/worker/entry.ts`，在 Next.js app 之前執行）：
   - 沒有密碼 → 401。secret 未設定 → 整站 503（預設鎖住）。
   - 所有非 GET / HEAD 請求 → 403，只允許 `POST /api/auth/password-login`。
   - LINE、LINE 登入、付款、訂閱、AI、帳號刪除、ensure-self、錯誤紀錄寫入、LIFF 等路徑：任何方法都 403。
2. **Supabase 唯讀過濾**（`web/src/lib/readonly/readonlyPreview.ts`），瀏覽器與伺服端套用同一套規則：
   - 瀏覽器的請求一律改走本站 `/__supabase` 代理（實測瀏覽器沒有任何直連 supabase.co 的請求）。
   - 伺服端的請求（middleware、API、頁面）經過 `readonlyServerFetch`。
   - 資料表只允許 GET / HEAD。
   - RPC 只允許白名單內的讀取函式，且一律**轉成 GET 呼叫**：PostgREST 以唯讀交易執行，函式內的任何寫入都會被資料庫拒絕。
   - Auth 只允許密碼登入、刷新、讀取使用者、登出；註冊、改密碼、OTP、admin API 一律拒絕。
   - Storage 只允許 GET；Realtime 與 Edge Functions 拒絕。
3. **沒有 service_role**：所有需要它的 API 走「未設定」路徑。

### 實測結果（2026-11-09）

- **存取控制**：
  - 沒有密碼 401、密碼錯誤 401。
  - 密碼正確 200，之後只帶 Cookie 也 200。
  - 未設定 secret 時整站 503。
- **寫入阻擋**：以下 14 種寫入全部 403，請求在 Worker 層就被擋下，不會送到 Supabase：
  - 直接寫資料表：INSERT `kb_audit_logs`、PATCH 自己的 `primary_role`、DELETE `sessions`
  - 寫入型 RPC：`kb_wallet_debit_cents`、`self_signup_to_session_by_share_code`
  - Auth 註冊、Storage 上傳
  - App API：`ensure-self`、LINE `notify-signup`、LINE webhook、LINE 登入、ECPay notify、admin `bulk-update-role`
  - 對頁面的 POST（Server Action）
- **過濾規則單元測試**：35/35（`npm run test:security`）。
- **真實資料讀取**：經代理讀取正式 Supabase 成功；anon 可見 3 個公開場次。
- **與 Vercel 比對**（同一個分享碼，同一支 `/api/public/session-roster`）：

  | 場次狀態 | 正選 | 候補 | 名單內容 |
  |---|---|---|---|
  | registration_open | 6 = 6 | 0 = 0 | 相同 |
  | round_finished | 18 = 18 | 1 = 1 | 相同 |
  | pending_confirmation | 1 = 1 | 0 = 0 | 相同 |

  公開報名頁兩邊都是 200。
- **重導向**：`/` → `/login`，`/dashboard`、`/member-dashboard`、`/billing` → `/login`。沒有循環、沒有導向 Vercel、沒有 5xx 或 504。
- **密碼登入路徑**：可以到達 Supabase Auth（錯誤帳密回 401 `Invalid login credentials`）。
- **白名單 RPC**：以 GET 執行正常；管理員 RPC 對 anon 回 `Access denied`。

### 尚未比對（需要以帳號登入）

會員總數、全部場次、歷史排組、錢包、營運報表都需要管理員或團主的登入身分，我沒有這些帳號。做法：

1. 用**有 Email 密碼的**管理員或團主帳號，分別登入 Vercel 與唯讀 Worker（唯讀站不支援 LINE 登入），依序比對 `/dashboard`、場次列表與名單、`/sessions/<id>` 排組歷史、`/billing`（唯讀錢包）、營運報表頁。
2. 或在 SQL Editor 執行 `00e`（唯讀），以其中的 B–G 段數字作為基準。

已知限制：開頁時會呼叫寫入型 RPC 的頁面（例如團主準備場次 `session_prepare_for_host`、`kb_ensure_my_billing_account`），在唯讀站會收到 403，可能出現錯誤提示。這是預期行為，代表寫入確實被擋下。

## 3. Cloudflare Workers

| Worker | 用途 | 後端 | 狀態 |
|---|---|---|---|
| `badminton-drop-in-preview` | Demo（保留） | 內建唯讀假資料，不連任何 Supabase | 運作中，26/26 |
| `badminton-drop-in-staging` | 整合測試（寫入流程） | **Staging Supabase**（部署腳本拒絕正式 ref） | 設定與防呆完成；**等 Staging 專案** |
| `badminton-drop-in-readonly` | 唯讀整合測試 | **正式 Supabase，唯讀** | 運作中（見 3A） |

兩者都只在 `*.workers.dev`，帳號鎖定 `feb96af4be0e308c286c3fd8d50e1941`，使用同一份 Next.js / vinext 程式碼。

`cf-deploy-preview.ps1 -Target demo|staging` 的流程：
1. 先 build。
2. 檢查產物：Worker 名稱、Supabase URL、不含正式 ref。
3. 通過帳號防呆後才上傳。

以下錯誤組合實測全部被拒（exit 2）：
- staging 未給 env 檔，或 env 指向正式
- staging 使用 Demo 後端
- demo 指向正式
- env 檔內含 service_role key

### 3.1 建立整合測試 Worker（需要使用者先建立 Staging Supabase）

```powershell
# 1) Staging 專案建立後（見 092/STAGING.md），在 repo 外建立 env 檔（只放公開值）
@"
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
"@ | Out-File -Encoding utf8 D:\project\secrets\staging.env

# 2) 建置驗證（不上傳）
cd D:\project\badminton\web
.\scripts\cloudflare\cf-deploy-preview.ps1 -Target staging -IgnoreEnvToken -EnvFile D:\project\secrets\staging.env

# 3) 上傳
.\scripts\cloudflare\cf-deploy-preview.ps1 -Target staging -IgnoreEnvToken -EnvFile D:\project\secrets\staging.env -Deploy

# 4) 設定 Staging 的 service_role（只對 staging Worker；互動輸入，不留在 history）
#    先確認 cf 的指令格式：
.\scripts\cloudflare\cf-account-guard.ps1 -IgnoreEnvToken -CfArgs workers,secrets,--help
```

Demo Worker 永遠不設定任何 Supabase secret。

## 4. 驗收矩陣

| # | 項目 | 方式 | 目前狀態 |
|---|---|---|---|
| 1 | Vercel 與 Cloudflare 歷史場次一致 | 同一個 DB：00e C2 逐場與兩邊的畫面比對 | 待 P0 完成後做唯讀比對（見 3） |
| 2 | 會員、報名、候補數一致 | 00e B / D 段 + 兩邊後台 | 同上 |
| 3 | 錢包餘額、營運報表無差異 | 00e F / G 段 + `/billing` 唯讀、營運報表頁 | 同上 |
| 4 | LINE 登入、Session Refresh | Staging 需測試 LINE channel | **缺測試 LINE channel** |
| 5 | 團主建立 / 開放場次 | Staging Worker | 待 Staging |
| 6 | 球友報名、代報名 | Staging Worker；DB 層已在 PGlite 以真實 RPC 驗證 | 待 Staging |
| 7 | 排組、Queue | Staging Worker | 待 Staging |
| 8 | ECPay 持續停用 | `ONLINE_PAYMENTS_ENABLED=false`；notify 與 topup 回 503（M1.4 已驗） | ✅（程式碼層） |
| 9 | 無異常 Redirect / 504 | Demo 實測無 404 / 5xx；Staging 再測一次 | Demo ✅ |
| 10 | 不破壞原有資料 | 00e 前後比對；PGlite：權限 SQL 前後 A–Z 相同 | ✅（PGlite） |

**正式資料的唯讀比對**（P0 完成後才做，需另外核准）：
- 只用 anon key 建置一個**不設 service_role** 的臨時 Worker。
- 只讀公開頁與登入後的唯讀頁。
- 比對完立刻刪除該 Worker。
- 目前的部署腳本刻意拒絕正式 ref，屆時需要另一個專用、有時效的腳本，由使用者核准。

## 5. 正式切換計畫（真實功能驗收全部 PASS 後）

### 5.1 網域問題（切換前必須決定）

目前正式網址是 `badminton-drop-in.vercel.app`，這是 Vercel 的子網域，**無法指到 Cloudflare**。
- **選項 A（建議）**：使用你自有的網域（例如 `play.<你的網域>`），掛在 Cloudflare Worker 的 Custom Domain。
- **選項 B**：直接使用 `badminton-drop-in.<帳號>.workers.dev`。

不論 A 或 B，切換後由舊的 Vercel 網址轉址到新網址，讓已分享在 LINE 群組的 `/s/<code>` 連結仍可使用。

### 5.2 需要在外部服務修改的設定（每一項都需你核准，且都可加回或改回）

| 服務 | 設定 | 做法 | 回滾 |
|---|---|---|---|
| LINE Login channel | Callback URL | **新增**新網域的 `/api/auth/line/callback`，保留舊的。App 依請求網域自動組 redirect_uri | 不需要（兩者並存） |
| LINE LIFF | Endpoint URL | 改為新網域 | 改回 vercel.app |
| LINE Messaging | Webhook URL | 改為新網域 `/api/line/webhook` | 改回 |
| Supabase Auth | Site URL / Redirect URLs | **新增**新網域 | 不需要 |
| ECPay | ReturnURL 等 | **不動**：付款仍停用 | — |

### 5.3 避免重複執行

- Vercel **沒有 cron**（沒有 `vercel.json`），程式碼中也沒有排程任務。
- LINE 推播（報名通知、遞補通知）只在使用者的請求中觸發，同一個請求只會到一個網域，不會重複發送。
- LINE webhook 只會打到 LINE 後台設定的一個 URL。
- ECPay 停用，沒有付款回呼。
- 分潤事件只在付款入帳時產生，目前不會發生。

### 5.4 切換步驟

1. P0 SQL 全部完成，並做完 00e 比對與備份。
2. 選定網域（5.1）。
3. 建立正式 Worker `badminton-drop-in-prod`。這個名稱需要另外加進 `cloudflare.config.ts`，並使用專用的 prod 部署腳本：
   - 使用者核准後才建立。
   - 接正式 Supabase。
   - 在 Worker 設定 service_role secret。
4. 先用 workers.dev 網址做**唯讀**冒煙測試：首頁、`/s/<code>`、登入頁、後台唯讀頁。
5. 公告維護時段，選在無場次的時間：
   1. 改 LINE LIFF 與 Webhook URL。
   2. 新增 LINE Login callback 與 Supabase Redirect URL。
   3. 綁定新網域。
6. 實測：LINE 登入、報名一筆測試場次、團主開放報名、排組。
7. 舊的 Vercel 部署改成全站轉址（308）到新網域。**保留 Vercel 專案**作為回滾。
8. 跑 00e，比對數字。

### 5.5 回滾（任一步失敗，約 5 分鐘內完成）

1. Vercel：取消轉址，重新部署原本的正式版本（Dashboard → Deployments → 上一版 → Promote）。
2. LINE LIFF 與 Webhook URL 改回 vercel.app。
3. 移除 Cloudflare 自訂網域綁定（Worker 保留，以便排查）。
4. 資料庫不需要回滾：兩邊共用同一個 Supabase，切換本身不改資料。
5. 若同時套用了 P0 SQL 且造成問題，依第 2 節的對應 rollback 處理。

## 6. 常用 PowerShell 指令

```powershell
cd D:\project\badminton\web
# 帳號防呆（必須顯示 PASS 與 feb96af4be0e308c286c3fd8d50e1941）
.\scripts\cloudflare\cf-account-guard.ps1 -IgnoreEnvToken
# 列出此帳號的 Workers
.\scripts\cloudflare\cf-account-guard.ps1 -IgnoreEnvToken -CfArgs workers,list
# Demo 部署（保留）
.\scripts\cloudflare\cf-deploy-preview.ps1 -Target demo -IgnoreEnvToken -EnvFile .\scripts\cloudflare\demo-preview.env -Deploy
# 唯讀整合測試（正式 Supabase；secret PREVIEW_ACCESS_PASSWORD 已設定）
.\scripts\cloudflare\cf-deploy-preview.ps1 -Target readonly -IgnoreEnvToken -EnvFile .\scripts\cloudflare\readonly-preview.env -Deploy
# 整合測試部署（Staging 建立後）
.\scripts\cloudflare\cf-deploy-preview.ps1 -Target staging -IgnoreEnvToken -EnvFile D:\project\secrets\staging.env -Deploy
# 品質檢查
npm run lint; npm run test:security; npm run build; npx vite build
# SQL 測試（PGlite，不連任何 Supabase）
cd ..\docs\proposals\092_billing_pause_rpc_lockdown\staging-test; npm install; npm test
```
