# 092 計費暫停與錢包 RPC 權限收斂（M1.3 提案，**尚未執行**）

> 狀態：**提案**。本資料夾所有 SQL 都還沒有對 Production（`ngudidpitcfyzmbphlgt`）執行過。
> 須經使用者核准才能執行；執行前請先跑 `00_inspect_readonly.sql`，並把結果附在核准紀錄上。

## 1. 依賴盤點（由 migrations 與 web/src 靜態分析整理）

| 項目 | 現況 | 呼叫來源 |
|---|---|---|
| `kb_open_registration_with_billing(uuid)`（最新版本在 052） | SECURITY DEFINER；開放報名時扣 1 單位配額，配額用完時改呼叫 `kb_wallet_debit_cents`（月費超額 NT$50／無方案 NT$80） | 只有 `sessions/[id]` 的「開放報名」會呼叫（M1.3 已改走 `lib/billing/openRegistration.ts`） |
| `kb_wallet_debit_cents` / `kb_wallet_debit` | SECURITY DEFINER，**沒有檢查呼叫者**；migrations 中沒看到 REVOKE，代表 PUBLIC／anon／authenticated 預設都能 EXECUTE | 只有其他 DEFINER 函式（billing）會在 SQL 內呼叫，前端沒有直接呼叫 |
| `kb_user_self_wallet_topup` | 已授權給 authenticated，單次最多可自行加值 20000 | 舊儲值頁（M1.3 已隱藏） |
| `kb_get_quota_dashboard(p_user_id)` | 可以查詢**他人**的配額與錢包資訊 | QuotaCard（M1.3 已隱藏） |
| `kb_subscription_activate/renew`、`kb_billing_*`、`apply_wallet_transaction`、`ensure_wallet_account`、`charge_session_first_start` 等 | DEFINER，大多沒有檢查呼叫者，也沒有 GRANT 限制 | 只有 DEFINER 函式或 service_role 的 API 會呼叫 |
| 輪次鎖定 `lock_round_and_increment_counters`（047） | **不涉及計費** | 排組流程，M1.3 沒有改動 |
| `BillingPreflightDialog`（RoundList） | 死碼，沒有任何地方渲染 | — |
| 報名 RPC（`self_signup_to_session_by_share_code` 等） | 只檢查 `status` 在開放清單內，且 `allow_self_signup = true`；**不涉及計費** | /s/[code]，M1.3 沒有改動 |

**結論**：被 REVOKE 的函式，在 SQL 層的呼叫者全部都是 SECURITY DEFINER，而 DEFINER 函式以 owner 權限執行，所以撤銷 anon／authenticated 的執行權不會讓它們之間的呼叫失效。

## 2. 最小變更方案

- **App（已在 `feat/cloudflare-workers-m0-m1` 完成，尚未部署）**
  - `lib/billing/billingGate.ts`：`BILLING_ENABLED = false`。
  - `lib/billing/openRegistration.ts`：先呼叫 `kb_open_registration_no_charge`。
    - 如果函式還沒部署（PGRST202／42883），改走 RLS 範圍內的 `sessions` update，條件是 `id = ? AND status IN (draft, pending_confirmation)`，回傳 0 列就視為 `NO_PERMISSION`。
    - RPC 回傳的權限錯誤會直接拋出，**不會**改走 fallback。
  - 隱藏 /billing、/billing/topup、/billing/upgrade，改顯示暫停說明（`(protected)/billing/layout.tsx`）。
  - Sidebar 和 Dashboard 移除帳務連結與 QuotaCard。
  - 管理後台「調整餘額」「調整會員」按鈕改為 disabled，餘額仍以唯讀顯示。
  - `api/admin/users/{adjust-wallet,grant-subscription,cancel-subscription,adjust-quota}` 一律回 503 `BILLING_PAUSED`。
  - 金流部分沿用 M1.2：ECPay notify 與 topup/create 回 503 `PAYMENTS_DISABLED`。
- **DB（本提案，待核准）**
  - `01_phase1_...sql`：
    - 撤銷錢包與扣款相關函式對 PUBLIC／anon／authenticated 的 EXECUTE，改為只授權 service_role。
    - 新增 `kb_open_registration_no_charge(uuid)`：權限與狀態檢查和 052 相同，但不計費。
    - 可以在部署新 App **之前**執行，因為舊 App 的開放報名只用到 `kb_open_registration_with_billing`，而它是 DEFINER，內部扣款仍然有效。
  - `02_phase2_...sql`：撤銷 `kb_open_registration_with_billing`、`kb_get_quota_dashboard`、`kb_ensure_my_billing_account`、`kb_admin_adjust_user_wallet`。**必須在新 App 上線之後才能執行**，否則舊 App 會無法開放報名。
  - `99_rollback.sql`：恢復原本的 GRANT，並 DROP `kb_open_registration_no_charge`。不會異動任何資料。
  - `03_verify_readonly.sql`：用 `has_function_privilege` 驗證權限、確認核心場次 RPC 仍可呼叫，並做錢包總額快照（與 00 的快照比對，應完全一致）。
- **不做的事**
  - 不刪除任何資料表或欄位，不刪除錢包或交易紀錄，不把餘額歸零。
  - 不修改 RLS、排組演算法、付款或分潤公式。

## 3. 執行順序（核准後）

1. `00_inspect_readonly.sql`：保存輸出，特別是錢包總額快照，以及實際的 GRANT 狀態。
2. `01_phase1_lockdown_and_no_charge_open.sql`
3. `03_verify_readonly.sql`：確認快照與 00 一致。
4. 部署新 App（Preview 驗證 → 正式環境，依 RUNBOOK 進行）。
5. `02_phase2_pause_billing_rpcs.sql`，再跑一次 `03_verify_readonly.sql`。
6. 出問題時：`99_rollback.sql`，並把 App 的 `BILLING_ENABLED` 改回 true 後重新部署。

## 4. 需要使用者決定的業務規則（阻礙）

1. **是否核准 01／02**。未核准前，Production 的錢包函式仍然可以被 anon／authenticated 直接呼叫（這是現有風險，並非 M1.3 造成）。
2. **RLS fallback 的權限語意**：在 `kb_open_registration_no_charge` 部署前，fallback 依靠 `sessions_update_host_owner_admin`（host／場館管理者／平台管理員）判斷權限，與 052 的「組織 owner／host／manager」不完全相同。
   - 組織成員中非 host 的 manager，在 fallback 期間可能無法開放報名。
   - 部署 01 後兩者就會一致。
3. **管理後台的錢包與訂閱工具是否也要暫停**：目前全部暫停。如果需要保留人工補償，例如手動入帳，請告知，再個別開放。
4. 暫停期間開放報名**不收費**：配額與錢包都不扣，事後也不補扣。如果日後要追溯計費，需要另外設計。

## 5. 測試（M1.3 Part E，本機、全 mock，沒有連到 Production）

- `openRegistration` 單元測試 8/8：
  - no_charge RPC 正常路徑；
  - fallback 的 payload 不含計費欄位，且帶 status 條件；
  - 保留既有的 `registration_opened_at`；
  - 0 列 → `NO_PERMISSION`；
  - 找不到場次 → `SESSION_NOT_FOUND`；
  - 非法狀態 → `INVALID_SESSION_STATUS`；
  - 已經開放 → 不做 update；
  - RPC 權限錯誤不會改走 fallback。
- UI 測試 33/33（`next dev` 搭配本機 mock Supabase）：
  - Dashboard 與 Sidebar 沒有帳務連結，也沒有 QuotaCard；
  - /billing、/billing/topup、/billing/upgrade 顯示暫停說明，且沒有呼叫 billing API；
  - 開放報名的三個情境（RPC 未部署、已部署、RLS 拒絕）都沒有呼叫任何 billing／wallet RPC。
- API（Next :3000 與 Worker :4173 都測過）：
  - 4 支 admin billing API 回 503 `BILLING_PAUSED`；
  - 2 支 ECPay notify 和 topup/create 回 503 `PAYMENTS_DISABLED`。
- /s/[code] 報名與代報名回歸測試：Next 54/54、Worker 54/54。
- 沒有在執行期測試、只做程式碼檢查的項目：候補遞補、團主手動標記已繳費、排組／Queue、營運報表。這些檔案在 M1.3 的 diff 中都沒有被改動。
- SQL 沒有預演，因為本機沒有 Docker／Postgres。建議在 Supabase branch 或 staging 上先跑一次 01→03→99。
