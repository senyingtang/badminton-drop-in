# SQL 檔案套用順序與相容說明

目標：**後續 patch 不覆蓋掉你已套用的功能**。請以「同一環境只走一條線」為原則：要嘛從 **001 基底**一路累加 patch，要嘛用 **整包 headless / subscription 快照** 建新庫；**不要**在已跑 001–032 的庫上再執行 `badminton_headless_schema_v*.sql` 或 `badminton_subscription_billing_schema_v1.sql` 全檔（會與增量腳本重複或衝突）。

---

## 一、建議順序（既有專案／增量維護）

數字為建議執行順序；同一列可視為同一主題，**由上而下**執行。

| 順序 | 檔案 | 說明 |
|------|------|------|
| 1 | `001_base_schema.sql` | 基底表 |
| 2 | `002_rls_policies.sql` | RLS |
| 3 | `003_seed_plans_and_defaults.sql` | 方案種子（計費／配額依賴） |
| 4 | `004_functions_and_triggers.sql` | 函式與觸發器 |
| 5 | `005_billing_schema.sql` | 計費 schema + `kb_get_quota_dashboard` 初版 |
| 6–14 | `005_rpc_and_views.sql` … `014_rls_scope_policies_by_role.sql` | 依檔名數字 |
| 15 | `015_participants_list_rpc_and_signup_dedupe.sql` | `list_session_participants_for_host` 初版 |
| 16–18 | `016` … `018` | 參與者／候補等 |
| 19 | `019_unlock_round.sql` | 解鎖輪次 |
| 20 | `020_rebuild_draft_round.sql` | 刪除草稿輪 |
| 21 | `021_apply_assignment_rpc.sql` | **舊** apply_assignment（3 參數） |
| 22 | `022_apply_assignment_replace_draft_round.sql` | 取代 021 的 draft 邏輯（仍 3 參數） |
| 23 | `023_list_session_participants_add_host_confirmed.sql` | RPC 加 `host_confirmed_level` |
| 23b | `023_pickup_group_settings.sql` | 與 023 主檔無函式名衝突時另跑 |
| 24–25 | `024` … `025` | 主辦調級、球員列表 RPC |
| 26 | `026_kb_resolve_billing_account_autocreate.sql` | 場次計費帳戶解析（**建議**在 preflight 前已套用） |
| 27–28 | `027` … `028` | 後台 KPI、錢包 RPC |
| **29** | **`029_rounds_per_court_migration.sql`** | **必須先於 030**：`rounds`/`assignment_recommendations` 加 `court_no`、拆舊 unique |
| **30** | **`030_apply_assignment_per_court.sql`** | **取代** 021/022 的 `apply_assignment_recommendation_and_create_round`（改 4 參數 + `court_no`） |
| **31** | **`031_finish_unlock_per_court_session.sql`** | **取代** 019/004 內舊版 `finish_round` / `unlock_round` 行為（每面場獨立） |
| **32** | **`032_list_session_participants_play_counts.sql`** | **取代** 023 的 `list_session_participants_for_host`（加場次／連續上場／鎖定欄位） |
| **33** | **`033_kb_get_quota_dashboard_fallback.sql`** | **取代** 005 的 `kb_get_quota_dashboard`；新增 `kb_ensure_my_billing_account`（帳務頁防空白） |
| **34** | **`034_signup_player_code_and_host_profile_auto.sql`** | **取代** `signup_via_share_code`（5 參數：自訂 `player_code`）；觸發器自動寫入 `host_player_profiles`（球員名單頁） |
| **35** | **`035_apply_assignment_compat_three_arg_overload.sql`** | **可選**：在已跑 **030** 後補上 **三參數** `apply_assignment…` overload（內部轉呼四參數）；修正「schema cache 仍找三參數」或舊前端仍打三參數時的 `Could not find the function …` |
| **36** | **`036_match_score_audit_trigger.sql`** | **可選**：比分變更時寫入 `audit_logs`（保留「更正比分」審計軌跡） |
| **37** | **`037_pickup_group_ui_preferences_and_theme.sql`** | 團主 UI 偏好（租借場地顯示方式）+ 主題配色；提供公開報名頁依分享碼讀取的 RPC |
| **38** | **`038_host_operation_reports_session_lock_public_roster.sql`** | 團主營運報表表 `host_operation_reports`；場次 **已結束／已取消** 後禁止 UPDATE；公開報名名單 RPC `get_public_session_roster_by_share_code` |
| **39** | **`039_platform_line_integration.sql`** | 平台 **LINE Messaging / LINE Login** 設定表 `platform_line_integration`（單列 id=1），RLS 僅 `platform_admin` |
| **40** | **`040_pickup_group_logo_storage.sql`** | Storage **`pickup-group-logos`**（公開讀、僅本人路徑可寫刪）；供臨打團 Logo 上傳 |
| **41** | **`041_platform_line_oa_add_friend_and_public_rpc.sql`** | 平台 LINE@ 加好友連結欄位 `oa_add_friend_url` + 公開讀取 RPC `get_public_platform_line_oa()`（供 /s/[code] Pop-up） |
| **42** | **`042_fix_players_select_policy_no_recursion.sql`** | 修正 `players_select` RLS（避免遞迴造成 `/rest/v1/players` 回 500、前端載入卡住） |

---

## 二、互斥與「只選一條」的函式

| 主題 | 保留哪個 | 不要重複套用 |
|------|-----------|----------------|
| `apply_assignment_recommendation_and_create_round` | **030**（4 參數 + `court_no`）為主；**035** 可選加回三參數 overload | 勿在已套用 030 後再跑 021／022（會覆寫主實作）；若需舊客戶端／快取相容請跑 **035** |
| `finish_round_and_release_locks` / `unlock_round_and_restore_counters` | **031** | 031 會整段 replace；若你手動改過請對照 031 |
| `list_session_participants_for_host` | **032**（含 023 的欄位 + 上場統計） | 已跑 032 後不必再跑 023 |
| `kb_get_quota_dashboard` | **033** | 已跑 033 後以 033 為準 |
| `signup_via_share_code` | **034**（5 參數） | 已跑 034 後勿再跑 011／015／016 內舊版 4 參數簽名；前端報名須傳 `p_desired_player_code`（可 null） |

---

## 三、不要與增量混用的檔案

- `badminton_headless_schema_v1.sql` / `badminton_headless_schema_v2.sql`：完整 schema 快照，適合 **新庫** 或文件對照。
- `badminton_subscription_billing_schema_v1.sql`：與 `005_billing_schema.sql` 主題重疊；已用 005 建計費者勿再整包執行。

---

## 四、帳務頁空白時

1. 確認已跑 **003**（方案／種子）、**005**（計費）、**026**（場次帳戶解析）。
2. 執行 **033**，再重開帳務頁；必要時按「嘗試建立我的計費帳戶」。
3. 若 RPC 報錯，檢查 Supabase 是否已 **grant execute** 給 `authenticated`（033 末尾已補 `kb_get_quota_dashboard` / `kb_ensure_my_billing_account`）。

---

## 五、與 GitHub 部署

程式與 `docs/*.sql` 可一併 commit；**資料庫狀態**仍須在 Supabase 手動依上表執行。部署前建議：`cd web && npm run build`。

## 六、本機以 DATABASE_URL 檢查（不進版控）

1. 在**專案根目錄**建立 `.env`（已被 `.gitignore` 的 `.env*` 排除），填入 `DATABASE_URL`。  
   - 若使用 **Transaction pooler（6543）** 出現 `Tenant or user not found`，請改採 Dashboard 的 **Direct connection**（`db.<ref>.supabase.co:5432`）字串。  
2. 在 `web` 目錄執行：`npm run db:inspect`  
   - 會讀取 `../.env` 的 `DATABASE_URL`，檢查 `029` 欄位、`030`/`032`/`033` 相關函式是否存在（**不會**印出密碼或完整連線字串）。
