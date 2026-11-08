# 092 帳務權限收斂（M1.3 Security Gate + M1.4，**尚未在任何 Supabase 執行**）

> 狀態：**提案**（M3 切換計畫見 `../093_cloudflare_cutover/README.md`）。所有 SQL 只在本機 PGlite 測過；PGlite 環境是用 repo 的 migrations 001–053 建出來的 Postgres。
> **沒有**對 Production（`ngudidpitcfyzmbphlgt`）或任何 Supabase 專案執行過。
> 執行前須經使用者核准，並先跑 `00_inspect_readonly.sql`，把結果附在核准紀錄上。

## 使用者決策

**M1.3（2026-11-08）**
- 開放報名不扣費，暫停期間不補扣。
- 保留所有錢包餘額與交易歷史。
- 保留人工標記繳費、營運報表與臨打核心功能。

**M1.4（2026-11-08，取代 M1.3「錢包全面暫停」）**
1. 保留錢包與交易紀錄：恢復**唯讀**顯示。
2. 保留 ECPay 與訂閱的串接能力：程式碼保留並補強驗證，但正式付款寫入維持關閉。
3. 優先修補資料庫的高權限漏洞。
4. 開放報名暫時免費，不扣錢包、不追溯補扣，並保留未來恢復收費的擴充能力。
5. 不放寬 host、組織 owner / host / manager 的權限，不影響 Cloudflare 遷移，不破壞報名、排組與報表。

## 檔案

| 檔案 | 用途 | 會改權限？ |
|---|---|---|
| `00_inspect_readonly.sql` | 盤點函式 ACL、帳務表的 RLS 與寫入權（G）、policies、owner、餘額快照 | 否（唯讀） |
| `00d_inspect_identity_readonly.sql` | **M1.5**：身分 / 權限唯讀診斷（單一 SELECT，可直接在 SQL Editor 執行；遮罩個資、不輸出機密）：schema、RLS、GRANT、SECURITY DEFINER、管理員帳號、異常（自行解除停權、測試帳號等） | 否（唯讀） |
| `01_phase1_lockdown_and_no_charge_open.sql` | 收回 12 個扣款 / 入帳函式的執行權與 30 張帳務表的 anon / authenticated 寫入權；新增 `kb_open_registration_no_charge` | 是 |
| `01b_rls_read_scoping.sql` | **M1.4**：替 18 張 kb 帳務表啟用 RLS 並建立 SELECT policy（僅限本人、組織 active owner/host/manager、平台管理員）；收回 anon 讀取；收回會繞過 RLS 的 view `kb_v_quota_dashboard_personal` | 是 |
| `01c_quota_dashboard_idor_fix.sql` | **M1.4**：`kb_get_quota_dashboard(p_user_id)` 原本可以查任何人的資料。改為包裝函式：非本人且非平台管理員時一律回 `NO_PERMISSION`；原函式改名為 `_unchecked`，只授權給 service_role | 是 |
| `01d_profile_role_escalation_fix.sql` | **P0（最高優先，可獨立部署）**：trigger 禁止使用者自己修改 `primary_role` / `is_active` / 刪除欄位 / `line_oa_user_id`；只有啟用中的平台管理員或 service_role / postgres 可以改。審查見 `M1.5_01d_REVIEW.md` | 是 |
| `01e_suspension_enforcement.sql` | **M3（P0）**：`is_platform_admin()` / `is_host()` / `is_venue_owner()` 加上 is_active / is_deleted；停權或已刪除者不能新增或修改報名（trigger）。須與新版 App（停權同步 ban Auth）一起上線 | 是 |
| `05_disable_007_test_accounts.sql` | **M3（P0）**：只在 00d L7 列出時執行。007 的 4 個 `@example.com` 測試帳號改為 ban、隨機密碼、player、停權；寫入稽核，不刪資料 | 是 |
| `02_phase2_pause_billing_rpcs.sql` | **M1.4 縮小範圍**：只收回 `kb_open_registration_with_billing` 和 `kb_admin_adjust_user_wallet`。`kb_get_quota_dashboard` 改由 01c 修正，`kb_ensure_my_billing_account` 只作用於本人，兩者都保留 | 是 |
| `03_verify_readonly.sql` | 驗證 01–01d、02、04 的權限與資料不變 | 否（唯讀） |
| `04_payment_order_mark_paid.sql` | **M1.4，只在重新開放付款前執行**：原子且冪等的入帳 RPC（含唯一索引，防止重複入帳），只授權給 service_role | 是 |
| `99a_rollback_phase2.sql` | 只恢復 02 收回的 2 個函式 | 是 |
| `99b_rollback_phase1_safe.sql` | 只移除 `kb_open_registration_no_charge`，**不會**重新開放 P0 | 是 |
| `99c_rollback_01b_01c.sql` | 移除 01b policies / RLS 與 01c 包裝函式（**會重新暴露讀取外洩與 IDOR**） | 是 |
| `99d_rollback_01d.sql` | 移除 01d trigger（**會重新暴露自我提權**），僅限緊急 | 是 |
| `99e_rollback_01e.sql` | 還原 002 / 007 的角色判斷函式並移除停權報名 trigger | 是 |
| `99f_rollback_05.sql` | 依稽核紀錄還原 05 的角色 / is_active 並解除 ban（密碼不還原） | 是 |
| `99z_restore_pre092_acl_UNSAFE.sql` | 完整還原 092 之前的權限，**會重新開放 P0**；僅限緊急且需書面核准 | 是 |
| `staging-test/` | 可重複執行的測試（PGlite）：`npm install && npm test`（test-01d、test-00d、test-m3、staging-test） | 只在記憶體中 |
| `M1.5_01d_REVIEW.md` / `STAGING.md` | 01d 專項審查與最小修復順序 / Supabase Staging 建置條件 | — |

## P0 / P1（依 migrations 推定，正式站須以 00 確認）

| # | 問題 | 修補 |
|---|---|---|
| 1 | **任何登入者可以 PATCH `app_user_profiles` 把自己改成 `platform_admin`**，或把被停權的自己改回 `is_active=true` | 01d |
| 2 | kb 帳務表沒有 RLS，而且 anon / authenticated 有完整寫入權，可以直接改錢包餘額，或把自己加為組織 owner | 01 |
| 3 | `kb_wallet_debit_cents` / `kb_wallet_debit`：DEFINER 函式且不檢查呼叫者，anon 可以扣任意帳戶的錢包 | 01 |
| 4 | `kb_user_self_wallet_topup`：任何登入者都能自行加值 20000 | 01 |
| 5 | `kb_subscription_activate` / `renew` 等 DEFINER 函式沒有身分檢查 | 01 |
| 6 | 沒有 RLS，任何人（包括 anon）都能讀取所有錢包、交易、訂閱與組織成員 | 01b |
| 7 | `kb_get_quota_dashboard(p_user_id)` 存在 IDOR，可以查別人的餘額與方案 | 01c |
| 8 | view `kb_v_quota_dashboard_personal` 以 owner 身分執行，會繞過 RLS | 01b |
| 9 | ECPay 回呼原本不驗 CheckMacValue 與 MerchantID，而且「讀餘額 → 寫餘額」不是原子操作，重送時可能重複入帳 | App（已改）＋ 04 |

本機已重現：上表 1–8 在修補前全部成功；修補後全部被拒（`staging-test/`）。

## 開放報名的權限（不得放寬）

| 主體 | 052 `with_billing` | `no_charge` |
|---|---|---|
| 場次 host | 允許 | 允許 |
| 場次帳務組織的 owner / host / manager（is_active） | 允許 | 允許 |
| 組織中 is_active=false 的成員、場館 owner（非 host）、平台管理員（非 host）、一般會員、anon | 拒絕 | 拒絕 |

- `no_charge` 的授權程式碼逐行沿用 052，11 種情境的矩陣測試結果完全一致。
- App 沒有 RLS fallback：RPC 不存在時，會顯示「開放報名功能更新中」，不會改寫 sessions。
- 未來要恢復收費時：把 `REGISTRATION_CHARGING_ENABLED` 改為 true，並以 99a 恢復 `with_billing` 的權限。

## 執行順序（核准後）

| 步驟 | 動作 | 對舊版 Vercel 正式站的影響 |
|---|---|---|
| 1 | `00d_inspect_identity_readonly.sql` 與 `00_inspect_readonly.sql`，保存全部輸出；00d 有 RISK 時先處理（見 `M1.5_01d_REVIEW.md` 第 7 節） | 無 |
| 2 | **`01d`**（P0，可以先單獨執行） | 無；一般使用者本來就不該改角色 |
| 3 | `01` → `01b` → `01c` | 無；舊版開放報名仍會照舊扣費（with_billing 保留） |
| 4 | `03_verify_readonly.sql`，與 00 的快照比對 | 無 |
| 5 | 部署新版 App。Preview 先接 Staging，之後才是正式網域 | 開放報名改為免費，錢包唯讀 |
| 6 | 確認沒有舊版前端仍在服務後，執行 `02`，再跑一次 `03` | 若舊版仍在線上，舊版的開放報名會出現 permission denied |
| 7 | **重新開放付款前**才執行 `04`，並完成下方的 ECPay 條件 | 無 |
| 8 | 出問題時，依對應關係回滾：02 → 99a、01b/01c → 99c、01d → 99d、01 → 99b。99z 只限緊急 | — |

## ECPay 重新開放前的條件

App 端已完成以下項目，並有單元測試；目前由 `ONLINE_PAYMENTS_ENABLED=false` 擋住：
- CheckMacValue（SHA256，以常數時間比較）
- MerchantID 核對
- MerchantTradeNo 與 TradeAmt 格式檢查
- 正式環境拒收 SimulatePaid
- 透過 `kb_payment_order_mark_paid` 原子入帳：核對訂單、金額與狀態，並以唯一索引防止重複入帳
- 偽造的回呼不會碰資料庫，也不會產生分潤

尚缺：
1. 結帳流程沒有產生 AioCheckOut 表單（目前 `payment_url` 為 null）。
2. HashKey / HashIV 要改放 Worker secrets（`ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` / `ECPAY_MODE=sandbox`）。
3. 執行 04。
4. 用公開的 Preview URL，搭配 ECPay 測試商店 3002607，完成 Sandbox 的正向與反向端對端測試。
5. 訂閱需要串接 ECPay 定期定額。目前 04 對訂閱只把帳單標記為已付款，**不會**啟用訂閱，也不會自動扣款。

## 測試

- **M3：00e / 01e / 05**（`staging-test/last-run-m3.txt`）：34/34 PASS。使用真實的報名 RPC（011–081）；權限 SQL 前後 00e 完全相同。
- **01d / 00d**（`staging-test/last-run-01d.txt`）：48/48、14/14 PASS。01d 單獨套用，並涵蓋「沒有 081 欄位」與「有 081 欄位」兩種 schema。
- **SQL**（`staging-test/last-run.txt`）：129/129 PASS。涵蓋：
  - 漏洞 baseline
  - 01–01d 冪等
  - 讀取範圍（本人、組織角色、管理員、anon）
  - IDOR
  - 自我提權
  - 04 的正常入帳、重送、金額不符、並發
  - 各 rollback
  - 餘額不變
- **App**：
  - `npm run test:security`：ECPay 27/27、openRegistration 8/8。
  - UI（mock Supabase）36/36。
  - 報名 / 代報名 UI 回歸測試：next 54/54，vinext 54/54。
  - 生產版 curl：4 個管理寫入 API、2 個 ECPay notify、topup/create，在兩個 runtime 都回 503。
  - lint 0 errors；next build 與 vinext build 都通過。
- **限制**：PGlite 的角色與 `auth.uid()` 是 stub。正式核准前，建議在真的 Supabase Staging 專案上跑一次完整流程。
