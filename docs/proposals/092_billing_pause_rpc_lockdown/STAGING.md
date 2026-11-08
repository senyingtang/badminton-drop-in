# Supabase Staging 建置條件（M1.5）

> 目的：在接近正式站的資料庫上，演練 00 / 00d → 01d → 01 → 01b → 01c → 03 → 02 → 03 → 各 rollback，
> 並作為 Cloudflare Preview 的後端。不使用正式 LINE Token、ECPay Secret 或真實使用者資料。

## 1. 專案

- 新建獨立的 Supabase 專案，例如 `badminton-staging`。**不要**用正式專案的 branch：branch 會共用 Auth 設定與帳務。
- 建議放在與正式站相同的 region、相同的 Postgres 大版本。

## 2. Schema 來源（擇一）

**A. 正式站 schema-only 複本（建議，最接近正式站）**
- 正式站曾在 Dashboard 手動修改，而 migrations 本身也有順序問題，所以複本比重放 migrations 更準確。
- 操作只讀取正式站 schema，**不含資料**，但仍會連到 Production，所以需要使用者核准。
  ```powershell
  # 在 repo 根目錄；密碼只在互動提示輸入，不寫入檔案
  npx supabase db dump --db-url "<PROD_DIRECT_URL>" --schema public -f ..\secrets\prod_schema.sql
  psql $env:STAGING_DB_URL -f ..\secrets\prod_schema.sql
  ```
- 複本不包含 `platform_line_integration` 等資料，所以 Staging 不會有正式 LINE / ECPay 機密。

**B. 重放 repo migrations**
依下列順序執行，均為 `docs/` 底下的檔案：
- **略過：**
  - 所有 `*_diagnostics.sql` 與 `*_verification.sql`
  - `badminton_headless_schema_v*.sql` 與 `badminton_subscription_billing_schema_v1.sql`
- **一般順序：** 依檔名數字遞增；同編號依下表。

| 順序 | 檔案 | 備註 |
|---|---|---|
| 001–004 | `001_base_schema` → `002_rls_policies` → `003_seed_plans_and_defaults` → `004_functions_and_triggers` | |
| 005 | `005_billing_schema` | `005_rpc_and_views` 是舊版，會因 `kb_players` 不存在而失敗，可略過 |
| 006–007 | `006_phase6_schema`、`007_phase7_schema`、`007_phase8_public_signup_rls` | `006_test_data`、`007_test_accounts_and_venue` **不要執行**（後者會建立密碼為 `password123` 的管理員） |
| 008–047 | 依數字遞增 | 023 有兩個檔案，兩個都要執行；021 / 022 會被 030 取代，仍需依序執行 |
| 048–053 | `048` → **`050_fix_plan_entitlements…`** → `049` → `051` → `052_fix…` → `053_fix…` | `049` 依賴 `050` 新增的欄位（PGlite 實測） |
| 054–086 | `054_fix…`、057–061、064–067、069、072、075_commission…、076_commission…、081、082_commission…、083、084、086 | **尚未在 PGlite 驗證**，需在 Staging 實跑確認 |

## 3. 測試帳號與角色

- 一律使用 `@example.test` 網域。密碼在本機隨機產生，存在密碼管理器，**不寫入 repo**。
- 建立方式：Supabase Dashboard → Authentication → Add user，再以 SQL Editor 設定 profile。

| 帳號 | primary_role | 狀態 | 用途 |
|---|---|---|---|
| admin@example.test | platform_admin | 啟用 | 管理頁、改角色、01d 合法路徑 |
| admin-suspended@example.test | platform_admin | `is_active = false` | 01d：停權中的管理員不能改角色 |
| host@example.test | host | 啟用 | 建立場次、開放報名（免費）、排組 |
| venue@example.test | venue_owner | 啟用 | 開放報名權限矩陣（應被拒絕） |
| org-owner / org-manager / org-inactive@example.test | host | 組織成員（啟用 / 啟用 / 停用） | 組織帳務讀取範圍、開放報名矩陣 |
| player@example.test | player | 啟用 | 報名、代報名、候補、提權攻擊 |
| player-suspended@example.test | player | `is_active = false` | 自行解除停權（應被拒絕） |
| player-deleted@example.test | player | 已刪除（走刪除 API） | 自行恢復（應被拒絕） |
| fresh@example.test | （無 profile） | — | 首次登入建立 player profile |

## 4. 假資料

- 場館 1 間、球場 3 面。
- 場次各一場：`draft`、`registration_open`、`pending_confirmation`、`assigned`、`finished`。
- 報名資料：一般報名、代報名（guest）、候補各數筆。
- 個人與組織 billing account，錢包有餘額並有歷史交易，用來驗證 01 / 01b 前後餘額不變。
- 方案：由 `003` 種子建立。
- Sandbox 付款訂單（`merchant_trade_no` 以 `SBX` 開頭），用來測試 04。
- `platform_line_integration` **保持空白**，或填入另建的**測試** LINE channel；不使用正式 channel。

## 5. 環境變數名稱（值不進 repo）

| 名稱 | 用途 | Staging / Preview 值的來源 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build 時寫入 | Staging 專案 URL（Preview 腳本會拒絕正式 ref） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build 時寫入 | Staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret | Staging service_role key |
| `NEXT_PUBLIC_LINE_LIFF_ID` / `NEXT_PUBLIC_LINE_LIFF_URL` | LIFF | 留空，或填測試 LIFF |
| `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` | 金流（目前程式關閉） | ECPay 公開測試商店 3002607 |
| `ECPAY_MODE` | 金流模式 | `sandbox` |
| `AI_*` | AI 功能 | 不設定 |
| `GIT_COMMIT_SHA` | 版本顯示 | 自動 |
| `STAGING_DB_URL` | 本機 psql 執行 SQL | 只放在本機 PowerShell process，不進任何檔案 |

LINE Messaging / Login 的憑證不在環境變數，而是在 DB 的 `platform_line_integration` 表，所以 Staging DB 空白即代表不會發出 LINE 訊息。

## 6. 權限驗證方式

1. **本機（不連任何 Supabase）：**
   ```powershell
   cd docs\proposals\092_billing_pause_rpc_lockdown\staging-test
   npm install
   npm test
   ```
   涵蓋 test-01d 48 項、test-00d 14 項、staging-test 129 項。
2. **Staging 專案：**
   - 依序執行 `00d`、`00`（保存結果）→ `01d` → `03` → `00d`（E 段應為 OK）→ `01` → `01b` → `01c` → `03` → `02` → `03`。
   - 接著演練 `99a`、`99c`、`99d`，再重新套用。
3. **以 REST 實際打一次：** 用 player 帳號的 JWT 對 Staging 執行以下請求：
   ```
   PATCH /rest/v1/app_user_profiles?id=eq.<自己>  {"primary_role":"platform_admin"}
   ```
   預期回應為 `42501 ROLE_CHANGE_NOT_ALLOWED`；改 `display_name` 則應成功。
4. **Preview Worker 上的人工驗收：**
   - LINE 登入：需測試 channel，沒有就略過。
   - 報名、代報名、候補、排組。
   - 團主開放報名（免費）。
   - `/billing` 唯讀顯示。
   - 管理頁改測試帳號角色。
