# 推薦碼 × 業務分潤 × 請款系統 — Phase 0 盤點（審計依據）

本文件為 **Phase 0 盤點**，依程式碼與 `docs/` 內 schema／SQL 對照整理，供後續 v1 開發使用。本輪 **未** 變更任何產品邏輯、註冊／付款流程或 migration。

---

## 1. 目前註冊流程盤點

### 1.1 Email／密碼註冊

| 項目 | 位置 |
|------|------|
| 註冊頁 | `web/src/app/(auth)/register/page.tsx` |
| 行為 | 呼叫 `supabase.auth.signUp({ email, password, options: { data: { display_name }}})`，成功後 `router.push('/dashboard')` |

註冊頁 **未** 直接寫入 `app_user_profiles`；依賴使用者進入受保護區後由 `useProfileSync` 補齊 profile（見第 2 節）。

### 1.2 LINE Login

| 項目 | 位置 |
|------|------|
| Callback | `web/src/app/api/auth/line/callback/route.ts`（Node runtime，service role） |
| 行為摘要 | 交換 token → 解析 `sub`／email／name → 若 `players.line_user_id` 已綁定則重用 `auth_user_id`，否則 `admin.auth.admin.createUser` 或依 email／`line_sub` 找既有 user → **若無** `app_user_profiles` 則 `insert` profile 與 `user_role_memberships` |

### 1.3 Supabase Auth「回跳」／Magic link

| 項目 | 位置 |
|------|------|
| 客戶端 callback | `web/src/app/auth/callback/page.tsx` |
| 行為 | 從 URL hash 讀 `access_token`／`refresh_token` 呼叫 `setSession`，或 PKCE `exchangeCodeForSession`；完成後 `router.replace(next)`（LINE flow 的 `next` 來自 `generateLink` 的 query） |

**無** 獨立的 `app/auth/callback/route.ts`（僅 `page.tsx`）。

### 1.4 其他

- `web/src/app/api/auth/line/start/route.ts`：啟動 OAuth。
- `web/src/app/api/auth/password-login/route.ts`、`whoami`：輔助 API。

---

## 2. 目前 role 預設盤點

### 2.1 欄位與資料表

- **主角色**：`public.app_user_profiles.primary_role`（型別於 `docs/001_base_schema.sql` 為 `app_role` enum）。
- **多角色成員**：`public.user_role_memberships`（`user_id`, `role`, `unique(user_id, role)`）。

### 2.2 兩套「新使用者預設」路徑（重要）

| 路徑 | 檔案 | `primary_role`／membership |
|------|------|------------------------------|
| 一般登入後首次進入 `(protected)` | `web/src/hooks/useProfileSync.ts` | 若無 profile：**`host`**，並 `user_role_memberships` 插入 **`host`** |
| LINE callback 新建 profile | `web/src/app/api/auth/line/callback/route.ts` | **`player`**，並插入 **`player`** |

因此：**Email 註冊後若第一次進入受保護版面，預設會被設為團主 `host`；LINE 新帳則為 `player`。** 兩者不一致，為後續「統一預設 player」的最小修改點之一（見第 2.3）。

### 2.3 最小修改點（僅規劃，本輪未改）

1. **`useProfileSync.ts`**：將預設 `primary_role` 與 `user_role_memberships.role` 由 `host` 改為 `player`（並評估是否需同步調整 `middleware.ts` 對「管理路由」的判定，避免新使用者被導到 `/dashboard` 再被 middleware 擋下）。
2. **或** 在 **Database trigger**（`auth.users` insert 後）統一建立 profile／membership（需 migration 與 RLS 設計，本輪未做）。
3. **LINE callback** 已為 `player`；改動 `useProfileSync` 後可與 Email 路徑對齊。

### 2.4 `players` 建立

- **LINE callback**：無既有 `players` 時會 `insert` `players`（`player_code`、`display_name`、`line_user_id`）。
- **Email 註冊**：註冊頁不建 `players`；會員中心顯示「尚未建立」直到報名或後台建立（見 `member-dashboard/page.tsx` 說明）。

---

## 3. 目前會員資料 table 盤點

| 表／概念 | 用途（盤點結論） |
|----------|------------------|
| `auth.users` | Supabase Auth 本體；`id` = app 內 `user_id` |
| `app_user_profiles` | **User 層級**主檔：`id` = `auth.users.id`，`display_name`、`primary_role` 等 |
| `user_role_memberships` | 同一 user 可多角色 |
| `players` | 球員實體；`auth_user_id` 可選；`player_code`、`display_name`、LINE 欄位 |
| `host_player_profiles` | 團主維度之球員／名單資料（與 `players` 不同用途） |
| `venue_host_memberships` | 場館與 host 關聯（場次表單有查詢） |

`venue_host_memberships`、`host_player_profiles` **不是**「全會員必有」；推薦碼層級應在 **user** 而非 `players`。

---

## 4. 推薦碼應掛載位置建議

### 4.1 建議：**`app_user_profiles` 延伸欄位** 或 **獨立 `member_referral_profiles`**

| 方案 | 優點 | 缺點 |
|------|------|------|
| **`app_user_profiles.referral_code`（+ 必要 unique index）** | 查詢簡單、與 `id = auth.uid()` 一致；RLS 可沿用 profile 政策延伸 | 表變胖；若未來要多版本／歷史欄位需再拆 |
| **新表 `member_referral_profiles(user_id → auth.users)`** | 關注點分離、易擴充 `is_active`、稽核欄位 | 多一次 join；需新 RLS／遷移 |
| **`players.referral_code`** | 無 | **不符合需求**（場主／純團主可能無 `players` 列） |

**結論（與需求對齊）**：推薦碼為 **每個 auth user 一組**，首選 **`app_user_profiles` 加欄位**（實作成本最低），或以 **`member_referral_profiles`** 若希望與「推薦關係」「後台補登」等 module 完全分離。

### 4.2 `user_id` 關係

- **單一真相**：`app_user_profiles.id` = `auth.users.id`。
- **`players.auth_user_id`**：可選、一對零或一；會員中心以 `auth_user_id` 查 `players`。

---

## 5. `/member-dashboard` 架構盤點

| 項目 | 說明 |
|------|------|
| 路由 | `web/src/app/(protected)/member-dashboard/page.tsx`（另有 `line-binding/`、`dropins/` 等） |
| Layout | `web/src/app/(protected)/layout.tsx`：`isMemberArea` 時使用 **會員專用 shell**（頂部 nav 含「會員中心」「全台臨打」「臨打報名」），**不**掛載管理後台 `Sidebar` |
| 資料取得 | **Server Component**：`createClient()`（server）+ `auth.getUser()`；`players` 以 `auth_user_id` 查詢；`get_public_platform_line_oa` RPC |
| 現有區塊 | LINE@ 加好友、通知綁定狀態、球員代碼 |
| 登入驗證 | Layout 層 `useUser` + middleware；頁面內再次 `getUser()` 保底 |

**後續 UI 插入點**：同一 `page.tsx` 或拆成子元件；分潤／請款建議 **新 API route**（service role 或 strict RLS）讀取 commission 表，避免在 client 直接暴露管理資料。

**付款證明顯示**：建議 **private bucket + 後端簽署 short-lived signed URL**（或只回傳 path 由 API 產生 signed URL），與現有 `LogoDropzone` 使用 **public** `pickup-group-logos` 不同。

---

## 6. `/dashboard` sidebar 架構盤點

| 項目 | 檔案 |
|------|------|
| Sidebar | `web/src/components/layout/Sidebar.tsx` |
| 邏輯 | `useEffect` 讀 `app_user_profiles.primary_role`；**管理角色**（`platform_admin` \| `venue_owner` \| `host`）使用 `managementNavItems`；**否則**僅 `memberNavItems`（目前只有「會員中心」） |
| 平台管理員 | 額外 append「管理後台」→ `/admin/dashboard` |

**與需求差異**：需求希望在 **`/dashboard` 管理側 sidebar**「總覽」下也看得到「會員中心／`/member-dashboard`」。目前 **管理角色** 的 `managementNavItems` **沒有** 會員中心連結（僅 player 的 `memberNavItems` 有）。**最小修改點**：在 `managementNavItems` 陣列於「總覽」下一筆加入 `{ label: '會員中心', href: '/member-dashboard', ... }`（**本輪未改**，依使用者要求不動 navigation）。

**是否影響 admin**：`/admin` 使用 `(admin)/layout.tsx` 獨立 top nav，與 `Sidebar.tsx` 無共用 config。

---

## 7. `/admin/dashboard` navigation 架構盤點

| 項目 | 檔案 |
|------|------|
| Admin layout | `web/src/app/(admin)/layout.tsx`（**client**） |
| Nav | **硬編碼** `navItems` 陣列，`href` 前綴 `/admin` |
| 權限 | `app_user_profiles.primary_role === 'platform_admin'` 才 `setAuthorized(true)`；否則導向 `/dashboard` |

**後續「業務分潤金」「分潤項目」**：可新增 `navItems` 項目指向例如 `/admin/dashboard/commissions`（**本輪未改**）。

**資料查詢**：多數 admin 功能透過 **API routes**（`web/src/app/api/admin/...`）+ `createServiceRoleClient()`；部分頁面可能直接 client 查表（需個別頁面確認）。

**共用 UI**：專案內既有 `btn`、card 樣式等；無強制共用 `DataTable` 抽象（依各頁為準）。

---

## 8. 付款／儲值／月費成功事件盤點

### 8.1 儲值金「成功入帳」寫入點（已實作之綠界 placeholder）

| 步驟 | 檔案 | 說明 |
|------|------|------|
| 建立訂單 | `web/src/app/api/payments/topup/create/route.ts` | `kb_payment_orders` `purpose: 'wallet_topup'`, `status: 'pending'`（**非**付款成功） |
| Webhook | `web/src/app/api/payments/ecpay/notify/route.ts` | `RtnCode === '1'` 時：若 order 已 `paid` 直接 **idempotent** 回 OK；否則 `update kb_payment_orders`（`where status = 'pending'`）、**加餘額** `kb_wallets`、`insert kb_wallet_transactions`（`txn_type: 'topup'`, `reference_type: 'payment_order'`）、`insert kb_billing_events` **`event_type: 'wallet_topup_paid'`** |

檔案內註解仍標 **TODO**（CheckMacValue 等），正式上線前須補齊驗簽與錯誤處理。

### 8.2 月費「付款成功」寫入點

| 路由 | 現況 |
|------|------|
| `web/src/app/api/subscriptions/ecpay/notify/route.ts` | 回傳 **501 `PROVIDER_NOT_CONFIGURED`**，**無** 寫入 subscription／帳本 |
| `web/src/app/api/subscriptions/create/route.ts` | 同上 **501** |
| `web/src/app/api/payments/newebpay/notify/route.ts` | **501**，未實作 |

**管理員手動開通**：`web/src/app/api/admin/users/grant-subscription/route.ts` 會寫入 `kb_subscriptions`、`kb_quota_buckets`、`kb_billing_events`（`event_type: 'admin_subscription_granted'`）、`kb_admin_audit_logs`。依業務定義 **不應計入** 業務分潤（非「使用者付款成功」）。

### 8.3 表用途摘要（依 `docs/005_billing_schema.sql`、`docs/048_*.sql` 等）

| 表 | 用途 |
|----|------|
| `kb_wallets` | 每 billing account 一錢包；餘額（含 `balance_cents` 延伸於 048） |
| `kb_wallet_transactions` | 錢包流水：`topup`、`debit_adjustment`、`credit_adjustment`、公開報名扣款理由 `session_registration` 等（見 enum／reason 於 SQL） |
| `kb_billing_events` | **稽核向度**事件列：`event_type`（text）、`charged_by`、`amount_cents`、`session_id`（可 null）、`reference_*`、`metadata`；**部分列有** `(session_id, event_type)` **唯一**約束（同場次同類型只一筆） |
| `kb_subscriptions` | 訂閱狀態與計費週期欄位 |
| `kb_plan_entitlements` | 各方案額度／超額價等 |

專案中 grep **未** 發現 `kb_payments` 表名；付款訂單以 **`kb_payment_orders`** 為準（048）。

### 8.4 不應計入分潤的事件（盤點）

| 類型 | 判斷依據 |
|------|----------|
| 開放報名扣儲值 | `kb_open_registration_with_billing` → `kb_wallet_debit_cents`（`reason`/`session_registration`）+ `kb_billing_events.event_type = 'session_registration_opened'`、`charged_by` 可為 `wallet` 或 `quota`（048） |
| 管理員調整錢包 | `api/admin/users/adjust-wallet`：`kb_wallet_transactions`（`reference_type: 'admin_adjust_wallet'`, `reason: 'manual_adjustment'`）、`kb_billing_events.event_type: 'admin_wallet_adjusted'`、`kb_admin_audit_logs` |
| 管理員贈與訂閱 | `grant-subscription`：`admin_subscription_granted` |
| 僅 pending 訂單 | `kb_payment_orders.status = 'pending'` |

### 8.5 分潤 hook 建議（設計層）

1. **儲值**：在 **單一、已 idempotent 的「訂單轉 paid + 入帳」** 交易尾端（現為 `ecpay/notify` 同一流程）插入 commission ledger；並以 **`kb_payment_orders.id` 或 `merchant_trade_no`** 做 **unique commission source** 防重複。
2. **月費**：待 **subscription notify 實作完成後**，在「訂單 paid + `kb_subscriptions` 更新」的同一 DB transaction 或同一 API 路徑掛 hook；現階段 **無** 正式付款成功路徑。
3. **避免重複**：依賴 **payment order 狀態轉移**（`pending` → `paid` 單次成功）+ commission 表 **unique(source_type, source_id)**（後續 schema）。

---

## 9. 現有 audit log 盤點

| 表／機制 | 位置／用途 |
|----------|------------|
| `kb_admin_audit_logs` | `docs/051_admin_manual_subscription_and_billing_function_fix.sql` 定義；`adjust-wallet`、`grant-subscription` 等 **API 有寫入** |
| `kb_billing_events` | 帳務／場次計費事件；**非**泛用 admin action log |
| `audit_logs` | `docs/001_base_schema.sql`；例如 `036_match_score_audit_trigger.sql` 比分變更 |
| `kb_audit_logs` | `docs/007_phase7_schema.sql`（舊／wallet 文件 `028` 曾 insert）；與 `kb_admin_audit_logs` 可能並存，需部署環境確認實際使用表 |
| `kb_session_events` | `docs/057_*.sql` — **場次流程**事件，非財務 admin |

**是否適合共用分潤稽核**：`kb_admin_audit_logs` 的 **actor／target／action／before_data／after_data** 模型已接近需求；可 **沿用並擴充 `action` 列舉值**（commission 相關）。若 commission 事件量極大、或需與 billing 強耦合，可另建 **`commission_audit_logs`** 專表再 **選擇性雙寫** 至 `kb_admin_audit_logs` 供後台「操作稽核」統一查詢。

---

## 10. Storage／圖片上傳盤點

| 項目 | 位置 |
|------|------|
| 現有上傳 | `web/src/components/pickup-group/LogoDropzone.tsx`：bucket **`pickup-group-logos`**，`supabase.storage.from(BUCKET).upload`；公開 URL 模式（`/object/public/...`） |
| 後續 payout 證明 | 建議 **`commission-payout-proofs` private bucket** + **server-side** 產生 **signed URL**；RLS：僅業務本人與 `platform_admin` 可讀（**本輪未建立 bucket**） |

**Server-side upload API**：目前盤點以 **client 直傳 storage** 為主；payout 建議改為 **API + service role** 或 **signed upload**，避免將寫入憑證暴露給前端。

---

## 11. 建議 DB schema 草稿（無 migration，僅設計）

以下命名可依團隊慣例加 `kb_` 前綴與既有表一致。

1. **`member_referral_profiles`**（或併入 `app_user_profiles`）：`user_id`、`referral_code`（unique）、`created_at`…
2. **`member_referral_links`**：`referrer_user_id`、`referred_user_id`、`referral_code_used`、`registered_at`、補登／更正欄位、`status`
3. **`commission_items`**：`code`、`name`、`default_rate_bps`、`is_active`、`sort_order`
4. **`commission_referrer_item_rates`**：每 referrer × item 覆寫 `rate_bps`
5. **`commission_events`**：帳本；`source_type` + `source_id` **unique** 防重複；`status`／`is_voided`／`adjusted_from_event_id`
6. **`commission_adjustments`**：可合併為 `commission_events` 一類型列（adjustment row）以簡化；獨立表利於報表
7. **`commission_payout_requests`**：請款主表；`proof_storage_path`；不含公開 URL 或仅存 signed URL 過期時間 metadata
8. **`commission_audit_logs`**：可選；若 `kb_admin_audit_logs` 足夠可延後

**第一版最小表（建議）**：`member_referral_profiles`（或 profile 欄位）、`member_referral_links`、`commission_items`、`commission_referrer_item_rates`、`commission_events`、`commission_payout_requests`。**adjustments** 可 v1 用 `commission_events` + metadata／關聯列表達，**commission_audit_logs** 可第二版或共用 `kb_admin_audit_logs`。

---

## 12. 分期開發建議（對應需求 Phase 1–7）

| Phase | 內容 | 主要檔案／SQL | 風險 | 測試 | 獨立部署 |
|-------|------|---------------|------|------|----------|
| 1 | 預設 player + 推薦碼 + 註冊填碼 | `useProfileSync.ts`、註冊頁、（可選）DB default／trigger；migration 產碼與 unique | **與現有 host 預設行為相反**；需回歸 middleware／首頁導向 | 新註冊、LINE 新帳、舊帳升級 host | 可，但需資料修補策略 |
| 2 | 分潤項目與預設／個人比例 | 新表 + admin CRUD API；**不**改 `admin layout` nav 可先直連 URL 測試（正式再加 nav） | 比例單位 bps 一致性 | Admin API 單元／手動 | 可 |
| 3 | 分潤事件帳本 | `commission_events` + RLS（多為 service） | 與現有 billing 混淆 | 插入測試資料驗證 query | 可 |
| 4 | 串付款成功 | `ecpay/notify`（儲值）；月費 notify 實作後再接 | **Webhook 重送、驗簽** | 重送同一 notify、金額不符 | 建議與 Phase 3 同版或緊接 |
| 5 | member-dashboard 顯示 | `member-dashboard/page.tsx` 或子元件 + API | 僅 player 看得到管理資料？需 RLS | 登入業務帳號看數字 | 可 |
| 6 | admin 分潤頁 | `/admin/...` 新頁 + API | 權限僅 `platform_admin` | 管理員操作 | 可 |
| 7 | 請款與證明 | `commission_payout_requests` + storage signed URL | 隱私外洩 | 業務／管理員各角色讀取 | 可 |

**建議優先順序**：先釐清 **Phase 1（role 一致化）** 與 **Phase 4 hook 點**（儲值已存在）；月費需先 **實作 subscription webhook** 才有可靠「付款成功」事件。

---

## 13. 風險與注意事項

1. **`useProfileSync` 預設 `host`** 與 **LINE `player`** 不一致 → 產品與分潤「業務資格」判定易錯。
2. **`kb_billing_events`** 對 `session_id`+`event_type` 有 **unique**，**不可**假設每筆付款都能用同一表無約束插入；分潤應用 **獨立 commission 表** 或嚴選 `event_type`／`session_id` null 列。
3. **月費付款路徑未接上** → 分潤 v1 若含月費需先完成金流 notify。
4. **Webhook 安全**：ECPay notify 仍為 placeholder 等級，上線前必須驗簽與鎖 IP／重放保護。
5. **`/member-dashboard` 與 `/dashboard` sidebar**：管理員導覽與需求文件敘述不同，屬 **UX／權限** 決策點。

---

*文件版本：Phase 0 盤點。相關唯讀診斷查詢：`docs/068_commission_system_contract_diagnostics.sql`。*
