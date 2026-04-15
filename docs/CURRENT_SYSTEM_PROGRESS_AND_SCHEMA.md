# 羽球排組平台 — 系統現況與資料結構統整

> **文件性質**：本機專案內進度／架構說明（非自動產生 schema dump）。  
> **撰寫基準日**：2026-04-15（依對話日）。  
> **專案路徑**：`D:\project\badminton`  
> **技術棧摘要**：Next.js（`web/`）+ Supabase（PostgreSQL + Auth + RLS + RPC）。  
> **正式遷移順序**：請仍以 [`SQL_MIGRATION_ORDER.md`](./SQL_MIGRATION_ORDER.md) 為準；本檔為**語意說明**與**功能對照**，執行 SQL 時請依該表順序。

---

## 一、目前進度（高階）

| 領域 | 狀態說明 |
|------|-----------|
| 身分與場館 | 登入／註冊、場館 CRUD、主辦與場館關聯（RLS 於 002、014 等逐步補強） |
| 場次與報名 | 場次建立、分享碼報名、`sessions` 公開欄位（006）、分享頁 `s/[code]` |
| 參與者與級數 | 候補／晉級、主辦確認級數、場內有效級數（015–018、023、024、032） |
| 排組與輪次 | 規則引擎前端 + **`029`–`031` 每面場獨立輪次**；`030` 四參數 apply；`035` 可選三參數相容 |
| 計費（kb\_\*） | `005` 訂閱／錢包／配額／扣款；`026` 場次帳戶解析；`033` 儀表板 RPC 與補帳戶 |
| 球員名單 | `host_player_profiles`、報名寫入、`034` 自訂 `player_code` + 觸發器 |
| 臨打團品牌 | `023_pickup_group_settings.sql` → `pickup_group_settings` 表 |
| 管理後台 | `(admin)/admin/*`、KPI／錢包相關 RPC（027、028） |
| 本機檢查 | `web/npm run db:inspect` → `tools/pg-migration-check.mjs`（需根目錄 `.env` 之 `DATABASE_URL`） |

---

## 二、前端（`web/src`）路由與職責對照

| 路徑（相對 `app/`） | 功能 |
|---------------------|------|
| `page.tsx` | 根路徑／導向 |
| `(auth)/login`、`register` | 登入、註冊 |
| `(protected)/dashboard` | 總覽 |
| `(protected)/sessions`、`sessions/new`、`sessions/[id]` | 場次列表、新建、單一場次（含輪次／排組 UI） |
| `(protected)/venues`、`venues/new`、`venues/[id]` | 場館管理 |
| `(protected)/pickup-group/settings` | 臨打團公開資訊設定（對應 `pickup_group_settings`） |
| `(protected)/players`、`players/[id]` | 球員名單、單一球員 |
| `(protected)/billing`、`billing/topup`、`billing/upgrade` | 帳務、儲值、升級方案 |
| `(protected)/my-matches` | 我的比賽紀錄 |
| `(protected)/settings` | 使用者設定 |
| `(admin)/admin/dashboard`、`users`、`audit` | 平台管理後台 |
| `s/[code]` | 分享連結進場（報名等） |
| `signup/[id]` | 報名流程相關頁 |
| `api/*` | Next.js API routes（例如 AI 狀態、其他 server 端邏輯） |

### 輪次／排組相關元件（重點檔案）

| 檔案 | 職責 |
|------|------|
| `web/src/components/rounds/RoundList.tsx` | 輪次列表、呼叫 `apply_assignment_recommendation_and_create_round`（四參數）、排下一輪流程 |
| `web/src/components/rounds/RoundPanel.tsx` | 單輪區塊容器與操作 |
| `web/src/components/rounds/AssignmentPreview.tsx` | 排組預覽彈窗 |
| `web/src/components/rounds/RoundList.module.css` | 輪次列表樣式 |
| `web/src/lib/engine/assignment-engine.ts` | 前端規則引擎（產生建議 payload） |

---

## 三、`docs/*.sql` 增量檔案一覽（每檔代表什麼）

> 數字檔為**建議維護線**；`badminton_*` 為整包快照，與增量混用須見 `SQL_MIGRATION_ORDER.md`。

| 檔案 | 功能／影響範圍 |
|------|----------------|
| **001_base_schema.sql** | 核心 enum、函式雛形、**主要業務表**（使用者、球員、場館、場次、參與者、排組、輪次、比賽、計費初版表、通知、稽核等） |
| **002_rls_policies.sql** | 資料列層級安全政策（基礎） |
| **003_seed_plans_and_defaults.sql** | 計費方案種子、`kb_*` 預設資料依賴 |
| **004_functions_and_triggers.sql** | 共用函式、觸發器（含舊版 finish/unlock 等，後由 031 取代行為者會註記於遷移順序文件） |
| **005_billing_schema.sql** | **訂閱制計費主 schema**：`kb_organizations`、`kb_billing_accounts`、`kb_plans`、`kb_subscriptions`、`kb_wallets`、`kb_quota_*`、`kb_billing_charges` 等；並對 `sessions` 加計費關聯欄位 |
| **005_rpc_and_views.sql** | 計費相關 RPC／視圖（與 005 表搭配） |
| **006_phase6_schema.sql** | 場次報名欄位：`max_participants`、`min_participants`、`fee_twd`、`fee_description`；場館聯絡／地圖；部分 `match_score_submissions` 早期形狀與公開 RLS |
| **006_test_data.sql** | 測試用資料 |
| **007_phase7_schema.sql** | `kb_notifications`、`kb_audit_logs`；`player_ratings.is_hidden`；管理員輔助函式等 |
| **007_phase8_public_signup_rls.sql** | 公開報名相關 RLS |
| **007_test_accounts_and_venue.sql** | 測試帳號／場館 |
| **008_notification_triggers.sql** | 通知觸發器 |
| **009_fix_sessions_rls_recursion.sql** | 修正 `sessions` RLS 遞迴 |
| **010_fix_sessions_players_rls_recursion.sql** | 修正 sessions／players RLS 遞迴 |
| **011_signup_via_share_code_rpc.sql** | 舊版 `signup_via_share_code`（後由 034 取代簽名） |
| **012_public_sessions_policy_statuses.sql** | 公開場次狀態政策 |
| **013_players_public_handle_line.sql** | `players` 加 `public_handle`、`line_user_id`（公開識別／LINE） |
| **014_rls_scope_policies_by_role.sql** | 依角色縮小 RLS 範圍 |
| **015_participants_list_rpc_and_signup_dedupe.sql** | 參與者列表 RPC、報名去重 |
| **016_participants_actions_and_levels.sql** | 參與者動作、級數相關 |
| **017_recreate_list_session_participants_for_host.sql** | 重建主辦參與者列表 RPC |
| **018_host_move_to_waitlist.sql** | 主辦將人移至候補 |
| **019_unlock_round.sql** | 舊版解鎖輪次（**031 後以每場為單位**） |
| **020_rebuild_draft_round.sql** | 刪除草稿輪／重建 |
| **021_apply_assignment_rpc.sql** | 舊 **三參數** apply_assignment（**030 後勿再跑**） |
| **022_apply_assignment_replace_draft_round.sql** | 021 的 draft 取代邏輯（仍三參數，**030 後勿再跑**） |
| **023_list_session_participants_add_host_confirmed.sql** | 列表 RPC 加 `host_confirmed_level`（**032 整段取代列表 RPC**） |
| **023_pickup_group_settings.sql** | **`pickup_group_settings`** 臨打團前台設定表 + RLS |
| **024_host_set_participant_session_level_rpc.sql** | 主辦設定場內有效級數 RPC |
| **025_list_host_player_profiles_for_self_rpc.sql** | 主辦檢視自身球員 profile 列表 RPC |
| **026_kb_resolve_billing_account_autocreate.sql** | 場次綁定／解析計費帳戶（autocreate 輔助） |
| **027_kb_admin_get_kpis_fix.sql** | 後台 KPI RPC 修正 |
| **028_kb_wallet_admin_and_self_topup.sql** | 錢包後台與自儲值相關 RPC |
| **029_rounds_per_court_migration.sql** | **`rounds`、`assignment_recommendations` 加 `court_no`**；拆舊 `unique(session_id, round_no)` → **每場每輪一筆**；資料遷移 |
| **030_apply_assignment_per_court.sql** | **`apply_assignment_recommendation_and_create_round` 改四參數**（含 `input_court_no`）；刪除舊三參數定義 |
| **031_finish_unlock_per_court_session.sql** | **每面場** `finish_round` / `unlock_round` 行為取代舊全場次邏輯 |
| **032_list_session_participants_play_counts.sql** | **`list_session_participants_for_host`**：上場次數、連續上場、鎖定狀態等欄位 |
| **033_kb_get_quota_dashboard_fallback.sql** | **`kb_get_quota_dashboard`** 新版／fallback；**`kb_ensure_my_billing_account`**（帳務頁空白防呆） |
| **034_signup_player_code_and_host_profile_auto.sql** | **`signup_via_share_code` 五參數**（`p_desired_player_code`）；觸發器／回填 **`host_player_profiles`** |
| **035_apply_assignment_compat_three_arg_overload.sql** | **可選**：三參數 overload，內部轉呼四參數（相容舊 PostgREST／舊前端） |
| **badminton_headless_schema_v1.sql / v2.sql** | 無 UI 之完整 schema 快照（**新庫**或對照用，勿與增量混跑） |
| **badminton_subscription_billing_schema_v1.sql** | 訂閱計費另一整包（與 005 主題重疊，已用 005 者勿整包再執行） |

---

## 四、資料表與欄位語意（依業務領域）

以下以 **001 為主體**，並標註常見**後續 migration 新增**欄位。型別細節以資料庫為準。

### 4.1 使用者與角色

| 表 | 欄位（精選） | 資料意義 |
|----|----------------|----------|
| **app_user_profiles** | `id` | 等於 `auth.users.id` |
| | `display_name`, `phone` | 顯示名稱、電話 |
| | `primary_role` | `app_role`：平台管理／場館主／主辦／球員 |
| | `is_active` | 帳號是否有效 |
| **user_role_memberships** | `user_id`, `role` | 一人可身兼多角色（與 primary 並存） |

### 4.2 球員與主辦視角

| 表 | 欄位（精選） | 資料意義 |
|----|----------------|----------|
| **players** | `player_code` | 全平台唯一球員代號（**034** 報名可自訂寫入規則） |
| | `auth_user_id` | 綁定登入使用者（可空：僅代碼報名） |
| | `display_name`, `handedness`, `gender`, `age` | 基本資料 |
| **players**（013） | `public_handle`, `line_user_id` | 公開識別、LINE 關聯 |
| **host_player_profiles** | `host_user_id`, `player_id` | 某主辦對某球員的一筆「名單視角」 |
| | `self_level`, `host_confirmed_level` | 自報級、主辦確認級 |
| | `default_level_adjustment` | 預設微調（-1～1） |
| | `warning_status`, `is_blacklisted`, `private_note` | 警示狀態、黑名單、主辦私有備註 |
| **host_player_level_adjustments** | `before_level`, `after_level`, `session_id` | 級數變更歷史（可綁場次） |
| **player_shared_notes** / **player_shared_note_history** | 多主辦可見備註與版本 |
| **player_ratings** / **player_rating_summary** | 評分細項與彙總；**007** 起 `player_ratings.is_hidden` 供審核隱藏 |

### 4.3 場館與時段

| 表 | 欄位（精選） | 資料意義 |
|----|----------------|----------|
| **venues** | `owner_user_id`, `name`, `address_text`, `city`, `district` | 場館擁有者與地址 |
| **venues**（006） | `contact_phone`, `full_address`, `google_maps_url` | 聯絡與地圖 |
| **courts** | `venue_id`, `court_no`, `name`, `intensity_label` | 場地編號與標示 |
| **venue_host_memberships** | 主辦可綁多場館 |
| **venue_time_slots** | `weekday`, `start_time`, `end_time`, `default_court_count` | 常態時段模板 |
| **host_session_requests** | 主辦向場館申請時段／場數／審核狀態 |

### 4.4 場次與參與者

| 表 | 欄位（精選） | 資料意義 |
|----|----------------|----------|
| **sessions** | `venue_id`, `host_user_id`, `title`, `start_at`, `end_at` | 場次時段與標題 |
| | `court_count`, `assignment_mode`, `allow_self_signup` | 面數、排組模式、是否開放自報名 |
| | `share_signup_code`, `status` | 分享報名碼、`session_status_type` 生命週期 |
| | `metadata` | 彈性 JSON |
| **sessions**（006） | `max_participants`, `min_participants`, `fee_twd`, `fee_description` | 人數上下限與費用說明 |
| **sessions**（005） | `billing_account_id`, `billing_status`, `first_started_at`, `quota_consumed_at`, `quota_ledger_id`, `overage_charge_id` | 與 kb 計費／配額消耗綁定 |
| **session_participants** | `session_id`, `player_id`, `host_player_profile_id` | 場次內報名列；可連回主辦名單 |
| | `source_type`, `status` | 報名來源、正選／候補／取消等 |
| | `priority_order`, `waitlist_order` | 正選優先、候補順序 |
| | `self_level`, `host_confirmed_level`, `session_effective_level` | 級數鏈（032 RPC 會一併呈現相關統計） |
| | `total_matches_played`, `consecutive_rounds_played` | 已賽局數、連續上場輪數（排組公平性） |
| | `is_locked_for_current_round`, `is_removed` | 當輪鎖定、軟刪除 |
| **session_waitlist_promotions** | 候補晉級紀錄 |
| **session_events** | `event_type`, `payload` | 場次事件稽核／稽核 log 型資料 |

### 4.5 排組、輪次、比賽

| 表 | 欄位（精選） | 資料意義 |
|----|----------------|----------|
| **assignment_recommendations** | `session_id`, `round_no`, `status`, `source`, `rule_summary`, `debug_payload` | 一次建議主檔 |
| **assignment_recommendations**（029） | **`court_no`** | **建議所屬面場**（每面場一筆建議與一輪對齊） |
| **assignment_recommendation_items** | `recommendation_id`, **`court_no`**, `team_no`, `participant_id` | 哪一面、哪一隊、哪一位參與者 |
| **rounds** | `session_id`, **`court_no`**, `round_no`, `status` | **同一輪號可有多筆**（每 `court_no` 一筆）；`draft`／`locked`／`finished` |
| | `recommendation_id`, `locked_at`, `finished_at` | 綁定建議與鎖定／完成時間 |
| **matches** | `round_id`, `court_no`, `match_label` | 該輪該場的一局 |
| | `final_score_team_*`, `winning_team_no`, `confirmed_*` | 完賽比分與確認者 |
| **match_teams** / **match_team_players** | 隊伍與場上參與者對應 |
| **match_score_submissions**（001 版） | `submitted_by_player_id`, `score_team_1/2`, `status` | 分數提交與審核狀態（若曾跑 006 早期 DDL，實際欄位以 DB 為準，建議以 001+後續 replace 為治理方向） |

### 4.6 計費（kb\_\*，005 為主）

| 表 | 欄位（精選） | 資料意義 |
|----|----------------|----------|
| **kb_organizations** / **kb_organization_memberships** | 組織型帳戶與成員角色 |
| **kb_plans** / **kb_plan_entitlements** | 方案代碼、價格、**每月配額**（依 host／personal）、試用場次、超額單價、功能旗標（名單共享、評分共享等） |
| **kb_billing_accounts** | `account_type`：`personal`（`owner_user_id`）或 `organization`（`organization_id`） |
| **kb_subscriptions** / **kb_subscription_periods** | 訂閱狀態與計費週期區間 |
| **kb_payment_methods** | 第三方付款方式參照 |
| **kb_wallets** / **kb_wallet_transactions** | 帳戶錢包餘額與流水 |
| **kb_quota_buckets** | 配額桶：`quota_limit` / `quota_used`、有效期間、`bucket_type` |
| **kb_quota_ledger** | 配額異動明細；**`session_id` + `action` 唯一**避免重複扣同一事件 |
| **kb_billing_charges** / **kb_billing_invoices** / **kb_billing_invoice_lines** | 扣款與發票結構 |
| **kb_usage_events** / **kb_feature_flags** / **kb_system_settings** | 使用量事件、功能開關、系統設定 |

### 4.7 臨打團設定（023）

| 表 | 欄位 | 資料意義 |
|----|------|----------|
| **pickup_group_settings** | `host_user_id`（唯一） | 一主辦一筆 |
| | `group_name`, `owner_display_name`, `intro`, `location` | 公開頁文案 |
| | `logo_url` | 團體 logo |

### 4.8 001 內建、但專案可能以 kb 為主的平行結構

以下表仍可能在舊流程或種子資料中使用；實際以你環境是否仍寫入為準：

- **billing_plans**, **subscriptions**（001 命名空間）
- **wallet_accounts**, **wallet_transactions**, **usage_charges**（001）
- **payment_provider_***（001）
- **notifications**, **audit_logs**（001 通用通知／稽核；007 另增 `kb_notifications`、`kb_audit_logs`）

---

## 五、重要 RPC／函式（名稱與用途速查）

| 名稱 | 說明 |
|------|------|
| `signup_via_share_code` | 經分享碼報名（**034**：五參數，含自訂 `player_code`） |
| `list_session_participants_for_host` | 主辦檢視參與者（**032**：含上場統計等） |
| `apply_assignment_recommendation_and_create_round` | 套用排組並建立草稿輪（**030**：四參數；**035**：可選三參數 overload） |
| `finish_round_and_release_locks` / `unlock_round_and_restore_counters` | **031**：以**面場**為單位結束／解鎖 |
| `kb_get_quota_dashboard` | 帳務總覽用（**033** 為準） |
| `kb_ensure_my_billing_account` | 確保個人計費帳戶存在（**033**） |
| `kb_resolve_billing_account_for_session`（或 026 內實際命名） | 場次與計費帳戶解析／自動建立輔助（見 **026**） |

完整參數與實作請在對應 SQL 檔內搜尋 `create or replace function`。

---

## 六、本機工具與環境變數

| 項目 | 說明 |
|------|------|
| `web/.env.local` 等 | Next／Supabase 公開 URL、anon key（不應 commit） |
| 專案根 `.env` | `DATABASE_URL`：供 **`npm run db:inspect`** 直接連 Postgres 檢查 migration 結果 |
| `web/tools/pg-migration-check.mjs` | 檢查 `rounds.court_no`、`assignment_recommendations.court_no`、關鍵 RPC 是否存在 |

---

## 七、維護建議

1. **新增功能**時：優先新增 **036\_*.sql** 類增量檔，並更新 `SQL_MIGRATION_ORDER.md` 與本檔相關小節。  
2. **對外部署**：程式可透過 GitHub 部署；**Supabase 必須手動執行**對應 SQL。  
3. **本檔更新**：重大 schema 或 RPC 變更後，請手動修訂「三、四、五」節以免與程式脫節。

---

*本文件為專案內說明用途；正式契約與法遵仍以實際部署與商業條款為準。*
