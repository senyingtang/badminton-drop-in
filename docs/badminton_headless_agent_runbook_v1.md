# 羽球臨打排組平台 AI Agent 開發執行手冊 v1

本手冊是給 AI Agent / 工程師直接照順序開工用的。  
目標不是介紹產品，而是把「先做什麼、再做什麼、每一步驗收什麼」寫清楚。

## 1. 目標輸出

本階段要先完成四份 migration：

1. `001_base_schema.sql`
2. `002_rls_policies.sql`
3. `003_seed_plans_and_defaults.sql`
4. `004_functions_and_triggers.sql`

完成後，系統至少要能支援：

- Supabase Auth 登入
- 角色：platform_admin / venue_owner / host / player
- 球員主檔與跨團識別 `player_code`
- 團主專屬球員資料 `host_player_profiles`
- Session 建立
- 正選 / 候補 / 遞補
- 分組建議主表與 round / match 結構
- 比分回報
- 共享備註與匿名評價
- 個人計次扣款
- 場主月費方案
- 試用與錢包

## 2. 執行順序

### Step 1：套用 base schema
先執行：

```sql
\i 001_base_schema.sql
```

驗收：
- 所有 enum, table, index 都建立成功
- `players.player_code` 為唯一且大小寫不敏感
- `sessions.share_signup_code` 為 partial unique index
- `host_player_profiles` / `session_participants` / `matches` 等核心表皆存在

### Step 2：套用 RLS
執行：

```sql
\i 002_rls_policies.sql
```

驗收：
- 所有公開業務表已開啟 RLS
- `platform_admin` 可全域管理
- `host` 僅能操作自己的資料、自己主持的 session、以及跨團共享信用資料
- `venue_owner` 可讀寫自己場館與旗下 host 的管理資料
- `player` 可讀寫自己的 player 主檔、自己參與的 session、自己的比分回報
- `payment_provider_events` 維持 service role only

### Step 3：套用 seed
執行：

```sql
\i 003_seed_plans_and_defaults.sql
```

驗收：
- 有三個基本方案：
  - `HOST_PAY_PER_USE`
  - `VENUE_MONTHLY`
  - `PLATFORM_INTERNAL`
- 預設價格：
  - host 每次 50 TWD
  - venue monthly 500 TWD
- trial_session_count 已設定

### Step 4：套用 business functions / triggers
執行：

```sql
\i 004_functions_and_triggers.sql
```

驗收：
- 更新 `player_ratings` 會同步刷新 `player_rating_summary`
- 更新 `player_shared_notes` 會寫入 `player_shared_note_history`
- `public.ensure_wallet_account()` 可建立錢包
- `public.apply_wallet_transaction()` 可安全寫入錢包流水
- `public.charge_session_first_start()` 可對 host 個人方案做首次開打扣款
- `public.promote_next_waitlist_participant()` 可完成候補遞補
- `public.lock_round_and_increment_counters()` 可鎖定 round 並增加出賽統計
- `public.finish_round_and_release_locks()` 可結束 round 並解除鎖定

## 3. API / 後端開發順序

### Phase A：身份與資料初始化
先做：
1. 使用者登入
2. 建立 `app_user_profiles`
3. 若是球員登入，建立 `players`
4. host / venue_owner 建立角色 membership

### Phase B：名單與 Session
再做：
1. 建立 venue / court / time slot
2. 建立 session
3. 建立 self-signup 頁
4. 支援正選 / 候補
5. 候補遞補

### Phase C：排組
再做：
1. 規則引擎產生 `assignment_recommendations`
2. host 套用建議生成 `rounds / matches / match_teams / match_team_players`
3. lock round
4. finish round
5. next round

### Phase D：信用資料
再做：
1. shared notes
2. anonymous ratings
3. rating summary
4. host 私有 warning / blacklist

### Phase E：金流
再做：
1. wallet top-up
2. session 第一次開打扣款
3. trial 次數判斷
4. venue monthly subscription
5. webhook 事件寫入 `payment_provider_events`

## 4. Agent 實作規則

1. 核心排組一定是規則引擎，不是 LLM 自由發揮。
2. LLM 只輸出：
   - 推薦分組
   - 推薦理由
   - 無解時替代方案
   - 強組合風險提示
3. 真正寫入 round / match 的資料，必須由後端 deterministic function 處理。
4. 所有扣款都必須帶 idempotency key。
5. 所有共享備註與評價都要保留審計欄位。
6. 球員不可查看自己的評價與共享備註。
7. 候補遞補必須留下 promotion log。
8. 月費過期預設「操作鎖定」，資料保留。

## 5. 後續建議檔案

完成這四支 migration 後，下一步建議新增：

- `005_views_and_rpc.sql`
- `006_reporting_views.sql`
- `007_test_fixtures.sql`

## 6. 金流自動續費前置資料

正式接金流前，至少要準備：

- 公司 / 商業登記資料
- 負責人身分驗證資料
- 收款帳戶
- 客服聯絡方式
- 退款規則
- 服務條款
- 隱私政策
- 試用規則與扣款說明文案
