# 092 計費暫停與帳務權限收斂（M1.3 Security Gate，**尚未在任何 Supabase 執行**）

> 狀態：**提案**。所有 SQL 只在本機 PGlite（以 repo 的 migrations 001–053 建立的 Postgres）測過，
> **沒有**對 Production（`ngudidpitcfyzmbphlgt`）或任何 Supabase 專案執行。
> 執行前須經使用者核准，並先跑 `00_inspect_readonly.sql`，把結果附在核准紀錄上。

## 使用者決策（2026-11-08）
1. 錢包、儲值、訂閱全面暫停。
2. 開放報名不扣費；暫停期間不補扣。
3. 管理員手動錢包入帳也暫停。
4. 保留所有錢包餘額與交易歷史。
5. 保留人工標記繳費、營運報表與全部臨打核心功能。

## 檔案

| 檔案 | 用途 | 會改權限？ |
|---|---|---|
| `00_inspect_readonly.sql` | 盤點：函式 ACL、**帳務表 RLS 與寫入權（G）**、policies、owner、餘額快照 | 否（唯讀） |
| `01_phase1_lockdown_and_no_charge_open.sql` | 收回 12 個扣款 / 入帳函式的執行權；收回 30 張帳務表的 anon / authenticated 寫入權；新增 `kb_open_registration_no_charge` | 是 |
| `02_phase2_pause_billing_rpcs.sql` | 收回 `kb_open_registration_with_billing`、`kb_get_quota_dashboard`、`kb_ensure_my_billing_account`、`kb_admin_adjust_user_wallet` | 是 |
| `03_verify_readonly.sql` | 驗證函式與資料表權限、核心 RPC 未受影響、餘額快照 | 否（唯讀） |
| `99a_rollback_phase2.sql` | 只恢復 02 收回的 4 個函式；**不會**重新開放 P0 | 是 |
| `99b_rollback_phase1_safe.sql` | 只移除 `kb_open_registration_no_charge`；**不會**重新授權扣款函式或資料表寫入 | 是 |
| `99z_restore_pre092_acl_UNSAFE.sql` | 完整還原 092 之前的權限，**會重新開放 P0**；僅限緊急且經書面核准 | 是 |
| `staging-test/` | 可重複執行的測試（PGlite），`npm install && npm test` | 只在記憶體中 |

## P0（依 migrations 推定，正式站須以 00 的 B、G 段確認）

1. **帳務資料表沒有 RLS，而且 anon / authenticated 有完整寫入權。**
   - 005 建立的 `kb_wallets`、`kb_wallet_transactions`、`kb_quota_buckets`、`kb_subscriptions`、`kb_billing_accounts`、`kb_organization_members` 等表都沒有 `enable row level security`；007 雖然替 `kb_wallets` 建了 policy，但 RLS 沒開，policy 不會生效。
   - 結果：
     - 只要有前端公開的 anon key，就能 `PATCH /rest/v1/kb_wallets` 直接改餘額。
     - 也能把自己加進 `kb_organization_members` 成為 owner，取得該組織場次的開放報名權。
   - 這個問題**比函式權限更嚴重**：只收回函式權限擋不住。
2. **`kb_wallet_debit_cents` 和 `kb_wallet_debit`**：SECURITY DEFINER、沒有檢查呼叫者、沒有 REVOKE。anon 可以扣任意帳戶的錢包。
3. **`kb_user_self_wallet_topup`**：已授權給 authenticated，任何登入者每次可以自行加值 20000。
4. **`kb_subscription_activate` / `kb_subscription_renew` / `kb_create_personal_billing_account_if_missing` / 舊版 `apply_wallet_transaction` 等**：DEFINER，沒有身分檢查。
5. 舊版 `wallet_accounts` 的 policy 是 `for all` owner，擁有者可以自己改餘額（App 已不使用這張表）。

以上 1–5 都由 **01** 封堵，而且 01 不需要等新版 App 上線。

本機已重現（`staging-test/`，01 執行前的 baseline）：anon 扣他人錢包、anon 直接改 `kb_wallets`、使用者自加為組織 owner、使用者自行加值 20000，**全部成功**；01 執行後全部被拒。

## 開放報名的權限（Task B）

| 主體 | 052 `with_billing` | `no_charge` | 舊的 RLS fallback（**已移除**） |
|---|---|---|---|
| 場次 host | 允許 | 允許 | 允許 |
| 場次帳務組織的 owner / host / manager（is_active） | 允許 | 允許 | **拒絕**（RLS 不認組織） |
| 組織中 is_active=false 的成員 | 拒絕 | 拒絕 | 拒絕 |
| 場館 owner（非 host） | 拒絕 | 拒絕 | **允許**（放寬） |
| 平台管理員（非 host） | 拒絕 | 拒絕 | **允許**（放寬） |
| 一般會員 | 拒絕 | 拒絕 | 拒絕 |
| anon | 拒絕 | 拒絕 | 拒絕 |

- `no_charge` 的授權程式碼逐行沿用 052。本機矩陣測試 11 種情境的結果完全一致。
- RLS fallback 會放寬場館 owner 與平台管理員的權限，因此已從 App 移除。`kb_open_registration_no_charge` 不存在時，App 會顯示「開放報名功能更新中」，**不會改寫 sessions**。
- 既有問題（不是取消計費造成的，092 也沒有改動）：`sessions_update_host_owner_admin` 允許 host、場館 owner 和平台管理員直接 PATCH sessions 的任意欄位，包括 status。其他狀態轉換（確認名單等）本來就走這條路。

## 執行順序（核准後）

| 步驟 | 動作 | 對舊版 Vercel 正式站的影響 |
|---|---|---|
| 1 | `00_inspect_readonly.sql`，保存全部輸出 | 無 |
| 2 | `01_phase1_lockdown_and_no_charge_open.sql` | 無。開放報名仍會照舊扣費，因為 with_billing 保留，DEFINER 呼叫鏈已測過 |
| 3 | `03_verify_readonly.sql`：與 00 的快照比對，應完全一致 | 無 |
| 4 | 部署新版 App。所有仍連 Production DB 的前端都要更新：Vercel 正式站（或切換網域到 Cloudflare）。Preview 先接 Staging | 開放報名改為不扣費 |
| 5 | **確認沒有任何舊版前端仍在服務**之後，執行 `02_phase2_pause_billing_rpcs.sql`，再跑一次 03 | 若舊版仍在線上，舊版的開放報名會出現 permission denied |
| 6 | 出問題時：02 → `99a`；01 → `99b`（安全版）。`99z` 只限緊急且需書面核准 | — |

- 01 必須在步驟 4 之前完成：新版 App 沒有 fallback，需要 `kb_open_registration_no_charge` 存在。
- 01 → 4 之間（約數小時）舊版 App 仍會扣費，這與「開放報名不扣費」的決策不同步。若要零落差，可以縮短 2 與 4 的間隔，或在步驟 2 之前先部署新版 App 並接受「功能更新中」的短暫錯誤。

## 測試

**SQL（`staging-test/last-run.txt`，73/73 PASS）**
- 涵蓋：baseline 漏洞重現、01 冪等、普通使用者與 anon 無法扣款或入帳或寫表、權限矩陣、團主免費開放、重複執行無副作用、餘額不變、02 之後新路徑可用而舊路徑被拒、99a / 99b 不會重新暴露、99z 確實會重新暴露。
- 限制：
  - PGlite 是 Postgres 17 單機版，角色、預設權限與 `auth.uid()` 是依 Supabase 行為自建的 stub。
  - Production 可能曾在 Dashboard 手動調整 RLS 或權限，所以 00 的實際輸出才是最終依據。
  - 正式核准前，仍建議在真的 Supabase Staging 專案上跑一次 00 → 01 → 03 → 02 → 03 → 99a → 99b。

**App**
- `openRegistration` 單元測試 8/8。
- UI 測試 28/28：mock Supabase；涵蓋 RPC 存在、RPC 不存在（不寫 sessions）、RPC 拒絕三種情況。
- lint 0 errors，next build 和 vinext build 都通過。
