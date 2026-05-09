# DB / CODE Dependency Audit（盤點報告）

本文件僅做「程式碼實際取用 DB contract」盤點：以 `web/src/**` 內 Supabase `.from(...)`、`.select(...)`、`.rpc(...)`、以及對資料欄位的直接存取為準；DB 是否存在則以 `docs/001_base_schema.sql` 與已存在的 `docs/*.sql` 定義作交叉比對（**非連線查 DB**，因此部分標註為「未知／需 DB 驗證」）。

> 本輪依你要求：**不修程式、不新增 migration（除了報告與診斷 SQL 檔本身）**，不討論／不要求執行舊場次修復。

---

## A. 程式碼目前實際使用的 DB table / column

> 欄位「是否 DB 目前存在」：  
> - **是（schema）**：可在 `docs/001_base_schema.sql` 找到  
> - **是（migrations）**：可在 `docs/0xx_*.sql` 找到（非 base schema）  
> - **未知**：程式碼用到了，但 docs 內未快速定位（可能存在於更早 migration / DB 已有）

| 功能區 | 檔案路徑 | table | column / key | 用途 | 是否 DB 目前存在 | 風險等級 | 備註 |
|---|---|---|---|---|---|---|---|
| 場次建立 | `web/src/components/sessions/CreateSessionForm.tsx` | `public.sessions` | `title` | 建立場次標題 | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `description` | 場次說明 | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `venue_id` | 場館 FK | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `host_user_id` | 團主 user id | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `created_by_user_id` | 建立者 user id | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `start_at` / `end_at` | 場次時間 | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `court_count` | 面場數 | 是（schema） | 中 | 程式碼大量使用；後續又有 `session_courts` 概念 |
| 場次建立 | 同上 | `public.sessions` | `assignment_mode` | 排組模式 | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `allow_self_signup` | 是否允許分享碼報名 | 是（schema） | 低 | insert |
| 場次建立 | 同上 | `public.sessions` | `share_signup_code` | 分享碼（URL /s/[code]） | 是（schema） | 高 | **公開報名、名單、查詢都依賴此欄位** |
| 場次建立 | 同上 | `public.sessions` | `status` | 初始狀態 `'draft'` | 是（schema） | 中 | status 白名單於多處硬編碼 |
| 場次建立 | 同上 | `public.sessions` | `metadata.max_participants` | 備援讀取 | 是（schema: metadata jsonb） | 中 | 程式碼對 metadata 與欄位都有讀取 |
| 場次建立 | 同上 | `public.sessions` | `metadata.fee_twd` | 備援讀取 | 是（schema: metadata jsonb） | 中 | 同上 |
| 場次建立 | 同上 | `public.sessions` | `metadata.shuttlecock_type` | 用球選項 | 是（schema: metadata jsonb） | 低 | 由前端寫入 |
| 場次建立 | 同上 | `public.sessions` | `metadata.shuttlecock_brand` | 用球品牌 | 是（schema: metadata jsonb） | 低 | 由前端寫入 |
| 場次建立 | 同上 | `public.sessions` | `metadata.rented_court_nos` | 租借實體場號列表 | 是（schema: metadata jsonb） | 高 | 與 `session_courts` 可能不一致時會造成顯示混亂 |
| 場次建立 | 同上 | `public.sessions` | `metadata.rented_court_labels` | 租借場號顯示 label | 是（schema: metadata jsonb） | 中 | |
| 場次建立 | 同上 | `public.sessions` | `metadata.rented_courts_text` | 手動文字模式 | 是（schema: metadata jsonb） | 低 | |
| 場次建立 | 同上 | `public.sessions` | `metadata.rented_courts_note` | 補充說明 | 是（schema: metadata jsonb） | 低 | |
| 場次建立（場館） | 同上 | `public.venues` | `id, name` | venue 下拉選單 | 是（schema） | 低 | select |
| 場次建立（場館） | 同上 | `public.venues` | `owner_user_id, is_active` | 篩選可用場館 | 是（schema） | 低 | |
| 場次建立（場地） | 同上 | `public.courts` | `id, court_no, name, venue_id, is_active` | 場館球場清單（勾選 2、3 號場） | 是（schema） | 中 | 若 `courts` 無資料則走 free text 或 fallback |
| 場次建立後寫入場地 | 同上 | `public.session_courts` | `session_id, court_no, label, sort_order` | 建立場次後 insert 對應實體場號 | 是（migrations: 058/061） | 高 | **RLS 若仍是 deny-write，這裡會失敗** |
| 場次詳情讀取 | `web/src/app/(protected)/sessions/[id]/page.tsx` | `public.sessions` | `*`（多欄位） | 讀取場次主檔 | 是（schema） | 中 | 目前用 `.maybeSingle()` |
| 場次詳情讀取（場館） | 同上 | `public.venues` | `name` | 嵌套 `venues(name)` | 是（schema） | 低 | join select |
| 場次詳情讀取（場地） | 同上 | `public.session_courts` | `court_no, sort_order, label` | 顯示租借場號 / RoundList slots | 是（migrations: 058/061） | 高 | 若 RLS/Schema cache 問題，將 fallback 走 metadata/court_count |
| 場次列表 | `web/src/app/(protected)/sessions/page.tsx` | `public.sessions` | `*, host_user_id, start_at, status` | 主辦場次列表 | 是（schema） | 低 | `.select('*, venues(name), session_participants(count)')` |
| 場次列表（統計） | 同上 | `public.session_participants` | `count` | 參與者數量 | 是（schema） | 低 | 計數嵌套 |
| 公開報名頁 | `web/src/app/s/[code]/page.tsx` | `public.sessions` | `share_signup_code` | 以 share code 找 sessions | 是（schema） | 高 | 查詢使用 `.ilike('share_signup_code', code)` |
| 公開報名頁 | 同上 | `public.sessions` | `status` | 決定是否顯示「尚未開放報名」 | 是（schema） | 高 | **程式碼白名單未包含 `registration_open`**（見 C） |
| 公開報名頁 | 同上 | `public.sessions` | `allow_self_signup` | 由 RPC 再檢查，但頁面也依賴 | 是（schema） | 中 | |
| 公開報名頁 | 同上 | `public.sessions` | `venue_id` | 再查 venues 詳情 | 是（schema） | 低 | |
| 公開報名頁（場館） | 同上 | `public.venues` | `name, full_address, google_maps_url, contact_phone` | 公開頁顯示場館資訊 | **未知（需 DB 驗證）** | 中 | base schema venues 欄位為 `address_text/city/district`，程式碼用 `full_address/google_maps_url/contact_phone`（疑慮） |
| 公開報名頁（玩家自有資訊） | 同上 | `public.players` | `*` | 讀玩家顯示名、line 綁定等 | 是（schema，部分欄需驗證） | 中 | base schema 無 line 欄位（見下） |
| 玩家資料 | 多處（API/頁） | `public.players` | `id, auth_user_id, player_code, display_name` | player profile | 是（schema） | 低 | |
| LINE 綁定 | 多處（API/頁） | `public.players` | `line_oa_user_id, line_user_id` | LINE UID 綁定 | **未知（需 DB 驗證）** | 高 | base schema 未包含，應由其他 migration 加欄 |
| LINE 綁定 | `web/src/app/api/line/webhook/route.ts` | `public.app_user_profiles` | `line_oa_user_id` | 會員綁定到 user profile | **未知（需 DB 驗證）** | 中 | 程式碼已用 `as any` 防欄位缺失但仍可能 400/500 |
| 報名名單（公開） | `docs/044_session_one_time_display_name_and_cleanup.sql`（RPC 定義）對應前端 `/api/public/session-roster` | `public.session_participants` | `session_display_name` | 公開名單顯示一次性暱稱 | 是（migrations: 044） | 中 | |
| 報名名單（公開） | 同上 | `public.session_participants` | `status, waitlist_order, is_removed, player_id` | roster 組合 | 是（schema） | 低 | |
| 報名名單（host 管理 UI） | `web/src/components/sessions/ParticipantList.tsx` | `public.session_participants` | `id, session_id, status, priority_order, waitlist_order, self_level, host_confirmed_level, session_effective_level, is_removed, created_at, total_matches_played, consecutive_rounds_played, is_locked_for_current_round, session_display_name, paid_at` | 名單管理 UI 顯示與操作 | `paid_at` **未知（需 DB 驗證）**；其餘多為 schema/migrations | 高 | 程式碼有針對 `paid_at` 欄位不存在做 fallback |
| 排組（round/match） | `web/src/components/rounds/RoundList.tsx` | `public.rounds` | `*`（含 `round_no, court_no, status, locked_at, finished_at, recommendation_id` 等） | 讀取輪次與巢狀 matches | 是（schema + 029/058 後可能擴充） | 中 | `rounds.court_no` 在 base schema 早期可能不存在，後續 migration 029 才加入（需 DB 驗證） |
| 排組（match） | 同上 | `public.matches` | `*`（含 `court_no, match_label, final_score_team_1, final_score_team_2, winning_team_no`） | 顯示比賽卡 | 是（schema） | 中 | |
| 計費（開放報名按鈕） | `web/src/app/(protected)/sessions/[id]/page.tsx` | `public.sessions` | `status` | 點「開放報名」後由 RPC 處理 | 是（schema） | 中 | |
| 計費（後台） | `web/src/app/(protected)/billing/page.tsx` | `kb_wallet_transactions` | `*, created_at` | 顯示交易 | 是（migrations） | 中 | 需 DB 確認 |

---

## B. 程式碼目前實際呼叫的 RPC / function

| 功能區 | 檔案路徑 | RPC / function | 傳入參數 | 回傳預期 | 是否 DB 目前存在 | 風險 |
|---|---|---|---|---|---|---|
| 場次準備（團主） | `web/src/app/(protected)/sessions/[id]/page.tsx` | `session_prepare_for_host` | `{ p_session_id: uuid }` | void | 是（migrations: 057） | 中 |
| 開放報名扣費 | `web/src/app/(protected)/sessions/[id]/page.tsx` | `kb_open_registration_with_billing` | `{ p_session_id: uuid }` | `{ ok?: boolean }` | 是（migrations: 048/049/052/051） | 高 |
| 公開名單 | `web/src/app/api/public/session-roster/route.ts` | `get_public_session_roster_by_share_code` | `{ p_share_code: text, p_viewer_player_id: uuid|null }` | roster rows | 是（migrations: 044/038） | 高 |
| 公開頁偏好 | `web/src/app/s/[code]/page.tsx` | `get_public_pickup_group_prefs_by_share_code` | `{ p_share_code: text }` | theme/prefs row | 是（migrations: 037） | 中 |
| 公開 LINE OA | `web/src/app/s/[code]/page.tsx`, `member-dashboard` | `get_public_platform_line_oa` | 無 | OA url | **未知（需 DB 驗證）** | 中 |
| 公開報名（登入後） | `web/src/app/s/[code]/page.tsx` | `self_signup_to_session_by_share_code` | `{ p_share_code, p_self_level, p_signup_note, p_session_display_name }` | inserted participant (json) | 是（migrations: 046） | 高 |
| 名單（主辦） | `web/src/components/sessions/ParticipantList.tsx`, `RoundList.tsx` | `list_session_participants_for_host` | `{ input_session_id: uuid }` | host view rows | 是（migrations: 057 覆寫/032） | 高 |
| 名單狀態變更 | `ParticipantList.tsx` | `confirm_participant_status` | `{ input_session_participant_id, input_new_status }` | void | **未知（需 DB 驗證）** | 中 |
| 候補順序 | `ParticipantList.tsx` | `host_set_waitlist_order` | `{ input_session_participant_id, input_new_order }` | void | **未知（需 DB 驗證）** | 中 |
| 候補遞補 | `ParticipantList.tsx` | `promote_next_waitlist_participant_simple` | `{ input_session_id }` | void | **未知（需 DB 驗證）** | 中 |
| 移到候補 | `ParticipantList.tsx` | `host_move_participant_to_waitlist` | `{ input_session_participant_id }` | void | **未知（需 DB 驗證）** | 中 |
| 本輪後離場 | `ParticipantList.tsx` | `host_set_participant_leave_after_round` | `{ p_session_participant_id, p_leave }` | void | 是（migrations: 057） | 中 |
| 鎖定本輪 | `RoundList.tsx` | `lock_round_and_increment_counters` | `{ input_round_id }` | void | **未知（需 DB 驗證）** | 中 |
| 結束本輪 | `RoundList.tsx` | `finish_round_and_release_locks` | `{ input_round_id }` | void | 是（migrations: 057 / 031） | 高 |
| 解鎖本輪 | `RoundList.tsx` | `unlock_round_and_restore_counters` | `{ input_round_id }` | void | **未知（需 DB 驗證）** | 中 |
| 刪除草稿輪次 | `RoundList.tsx` | `host_delete_draft_round` | `{ input_round_id }` | void | **未知（需 DB 驗證）** | 中 |

---

## C. 目前命名疑慮欄位對照表（以程式碼實際使用為準）

| 觀念 | 程式碼實際使用 | docs/schema 觀察 | 風險/說明 |
|---|---|---|---|
| 分享碼欄位 | `sessions.share_signup_code`（`/s/[code]` 查詢 `.ilike('share_signup_code', code)`） | `docs/001_base_schema.sql` 有 `share_signup_code`；且有 `uq_sessions_signup_code` | 若 DB 有其他欄位 `share_code/public_code/...`，程式碼**不會用到**；問題通常是 **status 白名單** 或 **share_signup_code 未寫入/被清空** |
| 公開頁可報名 status 白名單 | 前端 `/s/[code]`：`pending_confirmation/ready_for_assignment/assigned/in_progress/round_finished` | RPC `self_signup_to_session_by_share_code`（046）包含 `registration_open`；RPC roster（044）不含 `registration_open` | **最可疑：公開頁少了 `registration_open`**，會造成「後台已 registration_open，但公開頁顯示尚未開放」 |
| 場地資訊來源 | 優先 `session_courts` → fallback `metadata.rented_court_nos`/`rented_court_numbers` → fallback `1..court_count` | base schema 只有 `sessions.court_count` 與 `metadata`；`session_courts` 由 058/061 引入 | `session_courts` 若寫入失敗或 RLS 不允許，前端會 fallback；但「不一致」會造成顯示混亂 |
| player 顯示名稱 | `players.display_name` + `session_participants.session_display_name` | 044 有新增 `session_display_name` | OK |
| LINE 欄位命名 | 程式碼同時用 `players.line_oa_user_id`、`players.line_user_id`、偶爾提到 `line_uid` | base schema players 無 line 欄位 | **高風險：DB 欄位是否存在完全取決於既有 migration**；程式碼多處用 `as any` 仍可能在 select/where 直接失敗 |
| venues 欄位命名（公開頁） | `venues.full_address/google_maps_url/contact_phone` | base schema venues: `address_text/city/district` | **高風險：公開頁 venues 欄位可能與 DB 不一致** |

---

## D. 最小修復建議（不在本輪執行）

### 1) 程式碼應該改回舊欄位或 fallback 的地方

- 公開頁 `/s/[code]` 的 `signupOpenStatuses` 應與 DB 端 `self_signup_to_session_by_share_code` 的 status 白名單一致（目前前端少 `registration_open`，且 roster RPC 044 也少 `registration_open`）。  
- 公開頁 venues 顯示欄位應 fallback 到 base schema (`address_text/city/district`) 或後端提供統一 view / RPC（目前用 `full_address/google_maps_url/contact_phone`，docs schema 未對齊）。

### 2) DB 應該用新增 migration 補相容欄位 / policy / RPC 的地方

- players / app_user_profiles 的 LINE 欄位：若 DB 未存在 `line_oa_user_id` / `line_user_id`，需補 migration 或調整程式碼查詢欄位。  
- `session_courts` RLS：若 DB 仍沿用「全擋寫入」policy，會造成建立場次後寫入 `session_courts` 失敗 → 不一致。  
- 公開名單 RPC `get_public_session_roster_by_share_code` 的 status 白名單是否需包含 `registration_open`（目前 docs/044 未含）。

---

## E. 不要做的事（依你的要求）

- 不要再修舊 terminal sessions / 不要再改 terminal sessions.metadata  
- 不要再跑 058/059/060 去修舊 rounds/matches 實體場地映射（僅視為歷史 migration）  
- 不要依賴 `session_courts` 才能讀取場次（查不到 `session_courts` 應 fallback，不應變成「找不到場次」）  
- 不要讓 `session_courts` 查詢失敗造成「找不到該場次」

