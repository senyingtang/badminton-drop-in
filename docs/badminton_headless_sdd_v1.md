# 羽球臨打排組平台 SDD / AI Agent 實作說明書 v1.0

## 0. 文件目的

本文件是給產品規劃者、工程師、資料庫工程師、AI Agent、前後端開發者共同使用的系統設計說明文件。
目標是讓任何實作者都能依照本文件，清楚理解：

1. 產品要解決的問題
2. 角色與權限邏輯
3. 完整流程與狀態機
4. 資料模型與資料表關係
5. 分組規則與 AI 建議層
6. 收費、試用、錢包、自動續費邏輯
7. 候補、遞補、評價、共享備註的細節
8. 開發順序與每一步實作任務

本文件預設技術架構為：

- Frontend：Headless Web
- Backend：Supabase
- Database：PostgreSQL
- Auth：Supabase Auth
- Storage：Supabase Storage
- Payments：外部金流（後續接綠界、藍新或 Stripe 類型）
- AI：外部 LLM API，僅做建議層，不直接決定最終分組

---

## 1. 產品定位

本產品是「羽球臨打排組 SaaS 平台」，不是單純排隊工具。

核心能力：

- 團主建立臨打 Session
- 報名名單、候補名單、遞補管理
- 依級數、公平性、上場次數進行建議分組
- 團主人工確認與介入
- 開打鎖定、結束解鎖、逐輪重複
- 場主管理旗下團主與時段
- 球員跨團參與
- 團主之間共享球員備註與匿名評價
- 後續延伸 Elo / 成長曲線 / 勝率 / MVP / 排名榜

---

## 2. 產品核心原則

### 2.1 分級制度

- 採用 18 級業餘分級作為基準。
- 18 級是系統安排依據，不代表絕對實力真理。
- 同一球員在不同團主底下，可有不同確認級數。
- 球員可自填級數，但最終採認以團主確認級數為準。
- 本場 Session 可做臨時 ±1 微調。

### 2.2 排組原則

- 同隊兩人級差不得超過 1。
- 強度平衡採混合模式：
  1. 先滿足硬性規則
  2. 再最佳化兩隊強度差
- 目標避免連續 3 場上場情況發生。
- 目標讓出賽次數盡量平均。
- AI 僅提供建議，不直接決定最終分組。
- 團主可人工拆組、換人、覆蓋 AI 建議。

### 2.3 候補原則

- 每場 Session 需支援正選與候補名單。
- 若正選球員無法到場，由候補名單依順序自動提示遞補。
- 最終是否遞補成功，由團主確認。

### 2.4 評價與備註共享原則

- 球員可跨團參加。
- 球員共享 ID 為平台層級。
- 團主可對球員留下匿名評價與共享備註。
- 共享備註對所有團主可見。
- 評價僅供團主與場主參考，不直接影響排組。
- 球員不可查看自己的評價。

### 2.5 收費原則

- 個人團主方案：按下「開打」後，該 Session 扣款一次 50 元。
- 場主月費方案：500 元 / 月。
- 場主方案可有試用期，試用結束自動續費。
- 個人方案支援錢包。
- 月費到期後全鎖，但保留客服協助輸出名單的流程。

---

## 3. 角色與權限

### 3.1 角色清單

1. `platform_admin` 平台管理員
2. `venue_owner` 場主
3. `host` 團主
4. `player` 球員

### 3.2 平台管理員權限

- 管理所有帳號與方案
- 查看所有資料
- 處理申請、客服、爭議、資料輸出
- 調整平台設定、全域參數、試用規則

### 3.3 場主權限

- 建立與管理場館、球場、時段
- 建立旗下團主關係
- 查看旗下團主啟用狀態
- 幫旗下團主開團
- 強制關閉團
- 查看團主與球員評價資料
- 管理月費方案與續費狀態

### 3.4 團主權限

- 建立 Session
- 管理報名名單、候補名單
- 匯入固定參與者名單
- 拖拉歷史球員進本次名單
- 確認球員級數
- 調整本場有效級數
- 使用 AI 建議分組
- 人工改組
- 開打 / 結束 / 下一輪
- 查看所有團主共享備註與匿名評價
- 新增共享備註與匿名評價

### 3.5 球員權限

- 以登入或分享連結方式報名
- 填寫暱稱、球員 ID、級數等資料
- 提交比分回報
- 不能看到其他團主評價與備註
- 不能查看自己的評價資料

---

## 4. 身分與登入設計

### 4.1 登入模式

1. 團主個人帳號：Supabase Auth
2. 場主帳號：Supabase Auth
3. 球員帳號：可透過 Supabase Auth 或簡化為 player profile 綁定登入 ID

### 4.2 球員 ID 規則

- 由球員自行輸入
- 僅允許英數組合
- 系統統一轉為小寫保存，避免大小寫重複
- 必須全平台唯一

### 4.3 使用者資料模型原則

- `auth.users` 為認證主表
- 業務表 `app_user_profiles` 保存角色、顯示名稱等
- 球員身份與團主身份都可掛在同一認證帳號下，但業務上由角色區分

---

## 5. 主要模組

1. 認證與帳號模組
2. 場館 / 球場 / 時段模組
3. 團主 / 場主關係模組
4. 球員與固定名單模組
5. Session / 報名 / 候補 / 遞補模組
6. 分組與 Round 模組
7. 比分與賽果模組
8. AI 建議模組
9. 評價與共享備註模組
10. 方案 / 錢包 / 扣款 / 自動續費模組
11. 通知模組
12. 報表與未來 Elo 模組

---

## 6. 完整流程設計

## 6.1 團主開團流程

1. 團主登入
2. 選擇場館 / 場地 / 時段（或自行申請）
3. 建立 Session
4. 設定：
   - 場地數量
   - 預計開始時間
   - 預計結束時間
   - 分組模式
   - 是否開放球員自行報名
5. 匯入本次名單：
   - 固定名單拖拉
   - 歷史名單拖拉
   - 手動新增
   - 分享報名連結等待球員填寫
6. 管理正選 / 候補名單
7. 團主核對球員級數與本場有效級數
8. 二次確認名單
9. 進入系統分組頁面
10. 套用 AI 建議或人工調整
11. 團主確認分組
12. 按下開打
13. 系統鎖定 round，若為個人方案則執行本 Session 首次扣款
14. 比賽進行
15. 結束後解鎖，進入下一輪
16. 重複直到 Session 結束

---

## 6.2 球員報名流程

### 模式 A：球員自行報名

1. 團主發送分享連結
2. 球員開啟連結
3. 輸入 / 選擇：
   - player_id
   - 暱稱
   - 級數
   - 慣用手
   - 性別
   - 年齡
4. 送出報名
5. 狀態為 `pending`
6. 團主審核後改為 `confirmed_main` 或 `waitlist`

### 模式 B：團主代填

1. 團主於群組收集資料
2. 團主直接建立 session participant
3. 指定 main / waitlist
4. 後續球員若登入可綁定既有 player profile

---

## 6.3 候補與遞補流程

1. Session 需區分 `main` 與 `waitlist`
2. 候補需有 `waitlist_order`
3. 當正選狀態改為 `cancelled` / `no_show` / `unavailable` 時：
   - 系統找出排序第一名的有效候補
   - 產生「可遞補」提示
4. 團主按確認後：
   - 候補改為 `promoted_from_waitlist`
   - 指派為正選
   - 保留歷史遞補紀錄

---

## 6.4 Round 流程

1. 團主按「產生分組建議」
2. 系統根據當前可用球員、有效級數、上場次數、連打情況產生建議
3. AI 可輸出多組建議與說明
4. 團主人工調整
5. 團主按開打
6. round 狀態改為 `locked`
7. 若為本 Session 第一次開打，執行扣款
8. 球員比賽後回報比分
9. 團主確認比分
10. round 狀態改為 `finished`
11. 球員連打計數、總場次、勝負資料更新
12. 進入下一輪

---

## 7. 狀態機

## 7.1 Session 狀態

- `draft`
- `pending_confirmation`
- `ready_for_assignment`
- `assigned`
- `in_progress`
- `round_finished`
- `session_finished`
- `cancelled`

### Session 狀態說明

- `draft`：草稿建立中
- `pending_confirmation`：名單待二次確認
- `ready_for_assignment`：可進入分組
- `assigned`：已有分組草稿
- `in_progress`：已有進行中的 round
- `round_finished`：上一輪已結束，等待下一輪
- `session_finished`：整場結束
- `cancelled`：已取消

## 7.2 Round 狀態

- `draft`
- `locked`
- `finished`
- `cancelled`

## 7.3 Session Participant 狀態

- `pending`
- `confirmed_main`
- `waitlist`
- `promoted_from_waitlist`
- `cancelled`
- `no_show`
- `unavailable`
- `completed`

## 7.4 開團申請狀態

- `pending`
- `approved`
- `rejected`
- `cancelled`

---

## 8. 分組規則

## 8.1 硬性規則

1. 同隊兩人級差不得超過 1
2. 僅可從 `confirmed_main` 或 `promoted_from_waitlist` 且非 `unavailable` 的球員中分組
3. 已在進行中的 round 不可重複分配

## 8.2 軟性最佳化規則

1. 兩隊平均級數差盡量小
2. 兩隊總強度差盡量小
3. 平均每位球員出賽次數
4. 避免某位球員連續 3 場上場
5. 降低重複搭檔機率
6. 降低重複對手機率（後續擴充）

## 8.3 無解時處理

當無法滿足硬性規則時：

1. 系統先回報「無法在 ±1 內完成分組」
2. 提供選項：
   - 放寬至 ±2
   - 建議休息名單
   - 讓團主手動拆組
3. AI 可補充自然語言說明

## 8.4 預設強度池

同一 Session 可允許設定不同場地的強度池，例如：

- Court A：高強度
- Court B：休閒

若啟用，則優先在該強度池內選人。

---

## 9. AI 模組角色

AI 僅是建議層，不是裁決層。

### AI 任務

1. 根據規則輸出推薦分組
2. 解釋為何這樣排
3. 當無解時提供替代方案
4. 提醒誰連打過多
5. 提醒哪些組合歷史勝率過高，可能偏強
6. 生成 Session 摘要報表

### AI 不做的事

1. 不直接覆蓋團主決定
2. 不自行寫入最終 round 分配
3. 不直接封鎖球員參與
4. 不直接根據評價排除球員

---

## 10. 評價與共享備註設計

## 10.1 共享備註

- 所有團主可見
- 同一球員可有多筆備註
- 支援預設標籤 + 自由文字
- 可修改，但必須保留歷史版本
- 平台不做球員申訴流程（目前不需要）

### 備註類型建議

- `no_show`
- `late`
- `attitude`
- `skill_gap`
- `payment_issue`
- `other`

## 10.2 匿名評價

### 評價形式

採用混合方式：

- 1～5 星總分
- 多維度可擴充欄位

首版建議維度：

- punctuality 準時度
- attitude 態度
- reliability 穩定度
- skill_match 級數符合度

### 評價規則

- 匿名顯示給其他團主與場主
- 不顯示給球員本人
- 不影響排組演算法
- 僅供團主確認是否收人時參考
- 因團主可能嫌麻煩，建議首版支援：
  - 一鍵快速評價按鈕
  - 預設標籤模板
  - 可略過不填

### 關於「更優解」的建議

若擔心團主嫌麻煩，首版可優先做：

1. 一鍵三段式：推薦 / 普通 / 不推薦
2. 可選擇再展開進入 1～5 星與細項

這樣兼顧低摩擦與未來擴充。

---

## 11. 比分與賽果

## 11.1 回報流程

1. round 結束後，該 round 參與球員可提交比分
2. 比分僅該 Session 團主可見
3. 團主確認後才算正式賽果

## 11.2 建議流程

- 任一球員提交比分後，狀態為 `submitted`
- 若有多位球員提交，可做一致性檢查
- 團主按確認後，狀態改為 `confirmed`

## 11.3 首版實作建議

首版可先由團主最終確認，不做多人自動仲裁。

---

## 12. 收費、試用、錢包、自動續費

## 12.1 個人團主方案

- 單次計費 50 元 / Session
- 建立 Session 不扣款
- 第一次 round 成功 `locked` 時扣款
- 同一 Session 後續 round 不再重複扣款
- 使用錢包扣點或餘額

## 12.2 場主月費方案

- 500 元 / 月
- 先給試用期
- 試用期結束後自動續費
- 月費逾期則全鎖

## 12.3 逾期處理

逾期後：

- 不可新開 Session
- 不可編輯現有資料
- 不可使用 AI 分組
- 歷史資料可由客服協助輸出

## 12.4 要先準備的外部資料

要做試用結束自動續費，至少需準備：

1. 收款主體名稱
2. 公司 / 商業登記資料
3. 統編或對應收款身分資料
4. 銀行帳戶資訊
5. 客服聯絡資訊
6. 退款規則
7. 服務條款
8. 隱私政策
9. 金流商所需 KYC / KYB 文件

---

## 13. 資料模型總覽

## 13.1 主要實體

1. app_user_profiles
2. players
3. venues
4. courts
5. venue_host_links
6. venue_time_slots
7. session_requests
8. play_sessions
9. host_player_profiles
10. host_player_lists
11. host_player_list_items
12. session_participants
13. session_waitlist_promotions
14. session_player_status_logs
15. session_ai_recommendations
16. session_rounds
17. round_matches
18. round_match_players
19. round_score_submissions
20. player_shared_notes
21. player_shared_note_versions
22. player_ratings
23. subscription_plans
24. subscriptions
25. wallet_accounts
26. wallet_transactions
27. usage_charges
28. payment_events
29. notifications
30. audit_logs

---

## 14. 關鍵設計：球員共用身份 + 團主私有設定

本系統採混合模型：

- `players`：平台共用球員主檔
- `host_player_profiles`：某位團主對某位球員的私有設定

### `players` 放什麼

- player_id
- 預設暱稱
- 慣用手
- 性別
- 年齡
- 全域啟用狀態

### `host_player_profiles` 放什麼

- self_level
- host_confirmed_level
- default_session_adjustment
- warning_status
- private_note
- 是否加入固定名單

共享備註與匿名評價不放在 host private note，而是獨立資料表。

---

## 15. 資料表詳細規格

下方為高層欄位說明；完整 DDL 請看配套 SQL 檔。

## 15.1 app_user_profiles

用途：保存 Auth 使用者對應的系統角色與顯示資料。

重要欄位：
- id UUID PK（等於 auth.users.id）
- role
- display_name
- is_active
- created_at
- updated_at

## 15.2 players

用途：平台層共用球員主檔。

重要欄位：
- id UUID PK
- auth_user_id UUID nullable
- player_code CITEXT UNIQUE
- display_name
- handedness
- gender
- age
- is_active
- created_at
- updated_at

## 15.3 host_player_profiles

用途：團主對球員的私有設定。

重要欄位：
- id UUID PK
- host_user_id
- player_id
- self_level
- host_confirmed_level
- default_level_adjustment
- warning_status
- private_note
- is_blacklisted
- created_at
- updated_at

## 15.4 venues / courts / venue_time_slots

用途：場館、球場、時段定義。

## 15.5 venue_host_links

用途：場主與團主關係。

## 15.6 session_requests

用途：團主超出限制時提出申請。

## 15.7 play_sessions

用途：一場臨打 Session。

關鍵欄位：
- host_user_id
- venue_id
- court_count
- starts_at / ends_at
- status
- assignment_mode
- fee_mode
- first_lock_charge_applied
- allow_self_signup

## 15.8 session_participants

用途：本次 Session 的參與名單。

關鍵欄位：
- session_id
- player_id
- source_type
- participant_status
- is_main_roster
- waitlist_order
- self_level_snapshot
- confirmed_level_snapshot
- effective_level_snapshot
- is_checked_in
- is_unavailable
- joined_at
- left_at

## 15.9 session_waitlist_promotions

用途：記錄每次候補遞補。

## 15.10 session_rounds

用途：每一輪分組。

關鍵欄位：
- session_id
- round_no
- status
- generated_by
- generation_source
- ai_recommendation_id
- started_at
- ended_at

## 15.11 round_matches

用途：單輪中的某一場比賽。若同時有多面場地，會有多筆。

## 15.12 round_match_players

用途：某場比賽中的球員與隊伍資訊。

關鍵欄位：
- round_match_id
- session_participant_id
- team_no
- position_no

## 15.13 round_score_submissions

用途：球員比分提交。

## 15.14 player_shared_notes / player_shared_note_versions

用途：全平台團主可見的共享備註與版本紀錄。

## 15.15 player_ratings

用途：匿名評價。

## 15.16 subscriptions / wallet_accounts / wallet_transactions / usage_charges / payment_events

用途：方案、試用、錢包、扣款、金流事件。

## 15.17 notifications

用途：遞補、報名、扣款、續費等通知。

## 15.18 audit_logs

用途：重要操作留痕。

---

## 16. RLS 設計原則

首版建議：資料表一律預設不公開，逐表開權限。

### 基本原則

1. 平台管理員可看全部
2. 場主可看自己旗下場館、團主與關聯資料
3. 團主可看自己 Session、自己私有資料、所有共享備註與匿名評價
4. 球員只能看自己有關的報名與比分回報內容

### 共享備註與評價的特殊規則

- 所有 `host` 與 `venue_owner` 可讀取
- 僅建立者可修改自己建立的記錄
- 修改時採版本化，不直接覆蓋刪除

---

## 17. AI Agent 建議實作順序

這一段是給 AI Agent 或工程師當任務清單使用。

### Phase 1：基礎資料庫

1. 建立 extension
2. 建立 enum types
3. 建立 base tables
4. 建立 FK / index / unique constraints
5. 建立 updated_at trigger
6. 建立基礎檢查條件

### Phase 2：Auth 與 Profile

1. 建立 app_user_profiles
2. 建立 auth user 對應 hook
3. 建立角色判斷 function
4. 建立 basic RLS

### Phase 3：球員與團主關係

1. 建立 players
2. 建立 host_player_profiles
3. 建立固定名單
4. 建立共享備註與匿名評價

### Phase 4：場館與時段

1. 建立 venues
2. 建立 courts
3. 建立 venue_host_links
4. 建立 venue_time_slots
5. 建立申請流程表

### Phase 5：Session 與報名

1. 建立 play_sessions
2. 建立 session_participants
3. 建立候補遞補表
4. 建立 participant status log
5. 建立通知表

### Phase 6：Round 與比分

1. 建立 session_rounds
2. 建立 round_matches
3. 建立 round_match_players
4. 建立 score submissions
5. 建立團主確認流程

### Phase 7：收費

1. 建立 plans / subscriptions
2. 建立 wallet
3. 建立 wallet transactions
4. 建立 usage charge
5. 建立 payment events
6. 實作首次 lock 扣款邏輯

### Phase 8：AI 建議層

1. 實作規則引擎
2. 建立 AI recommendation table
3. 串外部 AI API
4. 保存建議內容與說明
5. 團主套用後寫入 round 草稿

### Phase 9：統計與未來 Elo

1. 建立結果彙整 job
2. 建立 player performance snapshot
3. 建立 Elo / ranking 模組

---

## 18. 實作時的重要限制

1. 所有狀態都必須走 enum，不可用自由字串
2. 候補遞補需保留歷史，不可直接覆蓋
3. 評價匿名，但資料庫仍需保存 rater_host_user_id
4. 共享備註需版本化
5. 本場有效級數是 snapshot，不可直接覆蓋長期級數
6. 扣款必須具 idempotency，避免重複收費
7. Round lock 後不可直接變更分組，需先強制解鎖或另建新 round 草稿
8. 自動續費不應直接依前端按鈕觸發，需依金流 webhook 驅動

---

## 19. 建議 API 邏輯（高層）

以下為給 AI Agent 理解的高層 API 邏輯，不是最終 OpenAPI。

1. `POST /sessions`
2. `POST /sessions/{id}/participants`
3. `POST /sessions/{id}/confirm-roster`
4. `POST /sessions/{id}/generate-recommendation`
5. `POST /sessions/{id}/rounds`
6. `POST /rounds/{id}/lock`
7. `POST /rounds/{id}/finish`
8. `POST /round-matches/{id}/score-submissions`
9. `POST /sessions/{id}/waitlist/promote`
10. `POST /players/{id}/shared-notes`
11. `POST /players/{id}/ratings`
12. `POST /wallets/{id}/top-up`
13. `POST /billing/webhooks/payment`

---

## 20. 首版 MVP 邊界

首版必做：

- 團主登入
- 場主登入
- Session 建立
- 報名名單
- 候補名單與遞補
- 固定名單拖拉
- 級數確認
- 分組建議
- 人工改組
- 開打 / 結束
- 比分回報與確認
- 共享備註
- 匿名評價
- 個人計次扣款
- 場主月費試用與續費

首版可延後：

- App
- LINE Bot
- Elo
- MVP
- 排名榜
- 進階風險模型

---

## 21. 本文件與 SQL 的關係

本文件負責：

- 流程
- 規則
- 權限
- 模型原則
- AI Agent 任務順序

SQL 檔負責：

- extension
- enum
- table
- column
- PK / FK / unique
- check constraints
- index
- trigger
- 基本 function

開發應以 SQL 檔為資料結構來源，以本 MD 為行為與規則來源。

---

## 22. 結論

本系統已明確定義為可實作的 Headless SaaS。

接下來應遵循順序：

1. 先執行資料庫 SQL
2. 再建立 Supabase RLS
3. 再做 API / edge functions
4. 再做前端流程頁
5. 最後接 AI 與金流

