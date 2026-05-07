# AI Agent 今日 Debug Runbook

## 目標

今天必須修完兩個主要問題：

1. 團主按「鎖定開打」時跳出 `wallet balance would become negative`，但新版錢包 / quota 明明足夠。
2. LINE 登入授權後回到報名系統，卻停留在登入頁。

---

## 問題 1：鎖定開打 Wallet Balance Negative

### 結論

根因是「新版 billing」與「舊版 wallet」雙軌同時扣款。

目前前端 `RoundList.tsx` 的流程：

1. `kb_billing_preflight_session_start(p_session_id)`
2. `kb_billing_consume_on_session_start(p_session_id)`
3. `lock_round_and_increment_counters(input_round_id)`

但舊版 `lock_round_and_increment_counters` 內部又呼叫：

```sql
perform public.charge_session_first_start(...)
```

而 `charge_session_first_start` 會扣舊表：

```text
wallet_accounts / wallet_transactions
```

新版錢包則是：

```text
kb_wallets / kb_wallet_transactions / kb_quota_buckets
```

所以團主看到的新版錢包或 quota 沒問題，但開打仍被舊錢包擋住。

### 修正步驟

1. 到 Supabase SQL Editor。
2. 執行本資料夾：

```text
047_fix_lock_round_new_billing.sql
```

3. 執行診斷：

```text
debug_diagnostic_queries.sql
```

第 3 段應回：

```text
OK: uses kb_billing v2 / no legacy wallet double charge
```

### 驗收

1. 找一個有新版 quota 或 kb_wallets 餘額的團主。
2. 建立 session。
3. 建立分組。
4. 按鎖定開打。
5. 不應再出現 `wallet balance would become negative`。
6. `sessions.billing_status` 應為：
   - `trial_consumed`
   - `quota_consumed`
   - `overage_charged`

---

## 問題 2：LINE 登入後回到登入頁

### 已發現風險

目前 `src/app/api/auth/line/callback/route.ts`：

- 若 LINE email 對應的 Supabase Auth user 已存在，`admin.auth.admin.createUser()` 會失敗。
- 失敗時會導回 `/login?error=line_user_create_failed...`。
- 但登入頁原本沒有讀取 query string `error`，因此使用者只看到「又回到登入頁」。

### 修正步驟

1. 將本資料夾 `route.ts` 覆蓋：

```text
web/src/app/api/auth/line/callback/route.ts
```

2. 將本資料夾 `login-page.tsx` 覆蓋：

```text
web/src/app/(auth)/login/page.tsx
```

3. 執行：

```bash
npm run lint
npm run build
```

> 若 Windows zip 帶入的 `node_modules/.bin/next` 在 Linux 環境無權限，請在本機 Windows 或 Vercel 重新 build；本次我已用 `tsc --noEmit` 檢查通過。

### LINE / Supabase 後台檢查

LINE Developers Console：

```text
LINE Login Channel > Callback URL
https://badminton-drop-in.vercel.app/api/auth/line/callback
```

Supabase Dashboard：

```text
Authentication > URL Configuration > Redirect URLs
https://badminton-drop-in.vercel.app/auth/callback
```

Vercel Environment Variables：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Database：

```sql
select login_channel_id, login_channel_secret is not null as has_secret
from public.platform_line_integration
where id = 1;
```

### 驗收

1. 開無痕視窗。
2. 打開：

```text
https://badminton-drop-in.vercel.app/member-dashboard
```

3. 被導向登入頁後，按 LINE 登入。
4. 授權後應進入會員中心。
5. 再打開：

```text
https://badminton-drop-in.vercel.app/api/auth/whoami
```

應看到：

```json
{"ok":true,"hasUser":true}
```

---

## 其他建議 Bug / 技術債

### A. 場主代團主開打時的 billing actor 問題

新版 `kb_billing_consume_on_session_start` 目前檢查：

```sql
v_session.host_user_id = auth.uid()
```

所以若未來允許 venue_owner 代 host 開打，會需要另外做 admin-aware consume RPC。

### B. LINE Login 與 LINE OA 是兩種 ID

- `players.line_user_id`：LINE Login 的 `sub`
- `players.line_oa_user_id`：Messaging API Webhook 的 OA userId

這兩個通常不是同一個值。若要推播，最穩的是 OA 綁定碼流程；LINE Login 僅能完成網站登入。

### C. 登入頁錯誤顯示

已用 `login-page.tsx` 修正。未來所有 OAuth callback 失敗都會在登入頁顯示錯誤，不會再讓使用者以為「沒有反應」。
