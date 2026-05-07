## 048：Billing / Wallet / Subscription / Payment Gateway（扣費點改為「開放報名」）

### 目標
- **扣費點已從「鎖定開打」改為「團主開放報名」**。
- 新增單一扣款入口：`public.kb_open_registration_with_billing(p_session_id uuid)`（server-side RPC）。
- 無月費與 quota 用完時，改以「儲值金」扣款：**單次 NT$80**。
- 預留金流商（綠界 / 藍新）與信用卡定期定額資料表與 API 骨架。

---

### 核心規則（務必）
#### 1) 扣費時間點
- **建立 session 不扣款**
- session 草稿不扣款
- **團主點「開放報名」成功（status 變更為 `registration_open`）才扣款**
- 扣款成功才允許開放報名
- 扣款失敗不可開放報名
- **Round lock / 開打不做任何 billing consume**

#### 2) 計費規則
- 若有 active subscription 且本期 quota_remaining > 0：**扣 quota 1**
- 否則：
  - **無月費用戶**：每次開放報名 **扣 wallet NT$80**
  - **個人月費 quota 用完**：每次開放報名 **扣 wallet NT$50**
- wallet 不足：raise `WALLET_INSUFFICIENT_BALANCE`
- wallet 不允許負數

#### 3) Idempotency
`kb_open_registration_with_billing` 具備 transaction + row lock + 狀態檢查：
- 重複點擊「開放報名」不會重複扣款
- session 已 billing_consumed / quota_ledger_id 已存在時直接視為 consumed

---

### 方案與顯示（UI/文案）
#### A. `free_wallet_only`（儲值金用戶）
- 月費：NT$0
- quota：0
- **每次開放報名扣 NT$80（8000 cents）**

#### B. `personal_monthly_500`（個人月費）
- 月費：**NT$500 / 月**
- quota：**10 次 / 月（以「開放報名」為消耗點）**
- quota 用完後：每次開放報名扣 **NT$50（5000 cents）**

---

### DB 與 migration
本次主要 migration：`docs/048_billing_open_registration_wallet_subscription.sql`

包含：
- `session_status_type` 新增 `registration_open`
- `sessions` 新增：
  - `registration_opened_at`
  - `billing_consumed_at`
  - `billing_charged_by`
  - `billing_event_id`
- Wallet cents 模型（延伸既有 `kb_wallets` / `kb_wallet_transactions`）：
  - `kb_wallets.balance_cents`
  - `kb_wallet_transactions.amount_cents` + `direction` + `reason` + `balance_after_cents` + `metadata` + `user_id`
- 新增：
  - `kb_billing_events`
  - `kb_payment_orders`
  - `kb_payment_provider_configs`
  - `kb_subscription_invoices`
  - `kb_subscription_events`
- 新增 RPC：
  - `kb_wallet_debit_cents`
  - `kb_open_registration_with_billing`

> legacy：舊表 `wallet_accounts` / `wallet_transactions` 保留但新流程不使用。

---

### Webhook 自動入帳（為什麼不能只靠前端回站）
#### 原則
- **不可只靠使用者「回站」就入帳**（瀏覽器回站可被偽造、也可能回站但未付款成功）
- 必須以 **server webhook** 或 **server 端查詢金流訂單狀態** 為準
- webhook 必須 **idempotent**：同一筆 `provider_trade_no` / `merchant_trade_no` 重送不可重複入帳

#### Topup 流程（預留）
1. 使用者建立儲值訂單：寫入 `kb_payment_orders (pending)`
2. 金流成功後 webhook：
   - 驗證簽章（綠界 CheckMacValue / 藍新簽章）
   - 找到 `merchant_trade_no`
   - 若已 paid：直接回 OK
   - 金額一致、狀態成功：更新 order paid、credit wallet、寫入 `kb_wallet_transactions`、寫入 `kb_billing_events`

目前狀態：
- 已建立 skeleton：
  - `POST /api/payments/topup/create`
  - `POST /api/payments/ecpay/notify`（待補 CheckMacValue）
  - `POST /api/payments/newebpay/notify`（回 `PROVIDER_NOT_CONFIGURED`）

---

### 信用卡定期定額（準備事項）
目前僅建立資料表/欄位骨架與 API route：
- `POST /api/subscriptions/create`
- `POST /api/subscriptions/ecpay/notify`
- `POST /api/subscriptions/cancel`

待你取得金流商資料後，需要補齊：
- Merchant ID、HashKey、HashIV、API endpoint
- webhook 驗證規格（簽章/CheckMacValue）
- 建立定期定額 API（委託單/扣款/取消）
- 扣款成功後：延長 period、建立 quota bucket、寫 invoice paid

---

### 金流設定後台
路徑：`/admin/payment-providers`
- 僅 `platform_admin` 可進入
- 密鑰欄位不在前端回顯明文
- 正式上線前：建議導入 secret manager 或 encrypted column

---

### 測試流程建議
1. 套用 SQL：`048` +（如有）更新過的 public signup RLS 檔
2. 建立 session（draft）：不扣款
3. 點「開放報名」：
   - quota 足夠 → quota_used + 1
   - quota 不足 → wallet - 50（個人月費）或 wallet - 80（無月費）
4. 重複點擊：不重複扣款
5. 鎖定 round：不扣款

