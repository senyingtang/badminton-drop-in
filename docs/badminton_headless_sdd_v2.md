# 羽球臨打排組平台 SDD / AI Agent 實作手冊 v2.0

> 本文件用途：作為產品規格、系統設計、資料庫建模、AI Agent 任務拆解、前後端實作、測試、營運交接的共同基準文件。  
> 本文件目標：讓 AI Agent 或工程師能依序完成資料庫、API、前端、排組規則、金流、通知與管理後台實作。  
> 本文件狀態：可直接進入開發。若未來有變更，應以版本號遞增並保留 migration 與 changelog。

---

# 1. 專案定義

## 1.1 產品名稱
羽球臨打排組平台（Headless Web 版）

## 1.2 產品定位
本產品是「羽球臨打團主 / 場主專用的 SaaS 排組與團務管理平台」。

它不是單純的抽籤工具，而是整合以下能力的營運系統：

1. 團主建立 Session（一次臨打時段）
2. 報名、候補、遞補
3. 球員分級與團主確認級數
4. AI 建議分組 + 規則引擎排組
5. 每輪開打鎖定 / 結束解鎖
6. 比賽結果回報與歷史紀錄
7. 跨團共享球員信用資料（備註、評價）
8. 個人計次 / 場主月費 / 試用 / 錢包
9. 未來擴充 Elo、成長曲線、排名榜、LINE 通知

## 1.3 技術方向
- 前端：Headless Web
- 後端：Supabase
- 資料庫：PostgreSQL
- 驗證：Supabase Auth
- 檔案：Supabase Storage（未來可放頭像、匯出檔）
- 金流：外部 Payment Provider（先預留抽象層）
- AI：外部 LLM API，僅做建議層與說明層，不做最終強制決策

## 1.4 系統核心原則
1. 規則引擎優先，AI 輔助。
2. 團主保有最終決定權。
3. Session 與 Round 必須可追溯、可審計。
4. 球員跨團共用身份，但團主對球員的等級確認可不同。
5. 備註與評價為團主 / 場主內部資訊，不給球員看。
6. 排組公平性優先於單純隨機。
7. 所有資料結構必須為未來 App / LINE Bot / Elo 擴充預留欄位。

---

# 2. 名詞定義

## 2.1 Session
一次臨打時段。  
範例：2026-04-05 19:00–22:00，2 面場。

## 2.2 Round
Session 內的一輪排組。  
一個 Session 可有多個 Round。

## 2.3 Match
一場實際對戰。  
一個 Round 在一面場上通常對應一場 Match。若 2 面場同時開打，則一個 Round 可能有多場 Match。

## 2.4 Player
球員主體，為平台共享身份。

## 2.5 Host Player Profile
球員在特定團主底下的專屬資料，例如：
- 該團主確認級數
- 該團主私有備註
- 該團主的黑名單 / 警示狀態

## 2.6 Shared Note
跨團共享備註，由團主建立，其他團主與場主可見。

## 2.7 Rating
球員評價，僅團主 / 場主可見，球員不可見。

## 2.8 Waitlist
候補名單。

## 2.9 Promotion
候補遞補成正選。

---

# 3. 角色與權限

## 3.1 角色
1. `platform_admin`
2. `venue_owner`
3. `host`
4. `player`

## 3.2 權限總表

### platform_admin
- 查看 / 管理所有資料
- 建立與調整方案
- 管理試用與續費狀態
- 處理申請、客服、資料匯出
- 可強制解除鎖定、修正錯誤資料

### venue_owner
- 建立場館、球場、時段模板
- 管理旗下團主
- 代團主建立 Session
- 批准 / 拒絕超額申請
- 查看旗下團主 Session 與球員評價資料
- 管理月費方案、試用、續費

### host
- 建立 Session
- 管理正選與候補
- 核對與調整球員級數
- 使用 AI / 規則建議排組
- 人工調整、拆組、換人
- 開打 / 結束 / 下一輪
- 建立共享備註與評價
- 查看所有團主共享備註與評價

### player
- 使用報名連結報名
- 維護自己的平台球員身份
- 填寫 player_code / 暱稱 / 性別 / 年齡 / 慣用手 / 級數
- 回報比分
- 不能查看共享備註與評價
- 不能查看自己的評價

---

# 4. 身份模型與資料邊界

## 4.1 使用者層
所有登入者都對應 `auth.users` 與 `app_user_profiles`。

## 4.2 球員層
`players` 是平台共享球員主體。  
同一球員在不同團主下，可對應不同 `host_player_profiles`。

## 4.3 球員代碼規則
- 欄位名稱：`player_code`
- 由球員自行輸入
- 僅允許英數字
- 系統保存時統一轉成小寫
- 全平台唯一
- 目的：避免同名球員衝突，供跨團識別

## 4.4 共享與私有資料界線

### 平台共享
- `players`
- 共享備註 `player_shared_notes`
- 評價彙總 `player_rating_summary`
- 評價明細 `player_ratings`

### 團主私有
- `host_player_profiles.private_note`
- 團主確認級數
- 團主私有警示 / 黑名單狀態
- 當場有效級數調整紀錄

---

# 5. 分級制度

## 5.1 基準
- 採用 18 級業餘分級
- 18 級僅為排組基準，不代表絕對實力

## 5.2 級數來源
### 情境 A：球員自行報名
球員填入級數，團主核對後確認。

### 情境 B：群組先報名、團主代填
團主依球員報名資訊手動建立名單。

## 5.3 級數層次
系統必須保存三層級數概念：
1. `self_level`：球員自填
2. `host_confirmed_level`：團主確認
3. `session_effective_level`：該 Session 實際採用級數

## 5.4 微調規則
- 團主可在 Session 內調整有效級數 ±1
- 微調不直接覆蓋長期級數
- 微調需記錄：原始值、調整後值、調整人、原因、時間

## 5.5 級數約束
- 級數範圍：1–18
- 任一級數欄位皆需受 constraint 保護

---

# 6. 排組規則與 AI 策略

## 6.1 排組核心規則
1. 同隊兩人級差不得超過 1
2. 先滿足硬性規則
3. 再最佳化兩隊強度差
4. 優先讓出賽次數平均
5. 盡量避免連續上場 3 場
6. 團主可人工覆蓋任何建議結果

## 6.2 強度平衡公式
採混合模式 D：
1. 先檢查硬性合法性
2. 計算兩隊總和差 / 平均差
3. 以最低偏差作為優先推薦
4. 若同分，優先選擇能讓出賽次數更平均的組合
5. 若仍同分，優先選擇較少重複搭檔的組合

## 6.3 無解時策略
若目前人數與級數無法排出合法組合：
1. 系統先嘗試規則式重算
2. 可放寬為同隊兩人級差 ≤ 2
3. AI 顯示替代建議：
   - 哪些人本輪休息
   - 哪些人可拆成不同池
   - 哪些組合是次佳方案
4. 最終由團主決定

## 6.4 連打規則
- 目標避免同一球員連續上場 3 場
- 這是軟性公平規則，不是絕對禁止
- 若無其他解，允許發生，但要提示團主

## 6.5 預設強度池
系統允許 Session 設定預設場地強度池，例如：
- Court 1：高強度
- Court 2：休閒

AI 建議與規則引擎可依此偏好做推薦。

## 6.6 AI 僅做以下事情
1. 生成推薦分組
2. 說明推薦理由
3. 提供無解時替代方案
4. 提示可能偏強組合
5. 根據歷史結果標記高勝率搭配風險

## 6.7 AI 不做以下事情
1. 不直接決定最終分組
2. 不自動扣款
3. 不自動黑名單球員
4. 不自動覆蓋團主操作

---

# 7. 報名、正選、候補、遞補

## 7.1 報名來源
1. 團主手動輸入
2. 固定名單拖拉
3. 歷史名單拖拉
4. 球員分享連結自填

## 7.2 報名結果狀態
- `pending`
- `confirmed_main`
- `waitlist`
- `promoted_from_waitlist`
- `cancelled`
- `no_show`
- `unavailable`
- `completed`

## 7.3 候補規則
- 每個 Session 支援正選與候補名單
- 候補按順序排列
- 若正選取消 / 未到 / unavailable，系統提示可遞補下一位候補
- 系統不自動強制遞補，最終由團主確認

## 7.4 遞補紀錄
每次遞補都需記錄：
- 原正選球員
- 候補球員
- 遞補順序
- 操作人
- 時間
- 原因

## 7.5 候補 UX 原則
- UI 必須清楚顯示「正選區」與「候補區」
- 必須能拖拉調整候補優先順序
- 必須能一鍵遞補
- 遞補後需保留歷史紀錄，不可直接覆蓋消失

---

# 8. Session / Round / Match 流程

## 8.1 Session 狀態機
- `draft`
- `pending_confirmation`
- `ready_for_assignment`
- `assigned`
- `in_progress`
- `round_finished`
- `session_finished`
- `cancelled`

## 8.2 Round 狀態機
- `draft`
- `locked`
- `finished`
- `cancelled`

## 8.3 開團主流程
1. 建立 Session
2. 匯入球員
3. 管理正選 / 候補
4. 核對級數
5. 二次確認名單
6. 進入排組頁
7. 套用 AI 或規則建議
8. 團主人工調整
9. 按下開打
10. 首輪鎖定成功後，如為個人方案則扣款
11. 球員比賽
12. 球員回報比分
13. 團主確認 / 結束本輪
14. 進入下一輪
15. 結束 Session

## 8.4 鎖定後仍允許
- 換人
- 改級數
- 強制解鎖

但任何鎖定後變更都必須寫入操作紀錄表。

## 8.5 中途加入
- 必須由團主手動加入 Session
- 新增後預設不影響當前 locked round
- 可納入下一輪推薦

## 8.6 中途離場
- 標記 `unavailable`
- 不自動刪除歷史紀錄
- 後續 round 不再納入排組

---

# 9. 比分、賽果、歷史資料

## 9.1 是否記比分
要。至少保存最終比分。

## 9.2 比分來源
- 由球員各自回報
- 該 Session 團主可見
- 如多位球員回報不一致，需由團主最終確認

## 9.3 建議資料流程
1. Match 建立時，先生成兩隊資料
2. 比賽結束後，球員提交比分
3. 系統保存多筆 `match_score_submissions`
4. 團主確認後寫入 `matches.final_score_team_a / final_score_team_b`
5. 系統標記勝方、敗方、確認時間

## 9.4 未來 Elo 擴充需求
為支援 Elo / 成長曲線，系統現階段就需完整保存：
- 每位球員哪場有上場
- 每場搭檔組合
- 每場對手組合
- 每場比分
- 每位球員當時有效級數

---

# 10. 備註、評價、信用機制

## 10.1 備註可見性
- 共享備註對所有團主可見
- 場主也可見
- 球員不可見

## 10.2 備註類型
同時支援：
1. 結構化標籤
2. 自由文字

## 10.3 備註維護規則
- 可修改
- 必須保留歷史版本
- 實作方式：主表 + history 表

## 10.4 評價形式
因你要求 B + C，建議使用：
1. `overall_score`：1–5 分
2. 多維度可選：
   - `punctuality_score`
   - `sportsmanship_score`
   - `communication_score`
   - `stability_score`
3. 可附短評

## 10.5 更優解（減少團主嫌麻煩）
建議 UI 提供「一鍵評價」快捷按鈕：
- 準時、好配合、可再次接受、臨時取消、放鳥

系統將快捷按鈕自動映射成：
- 星等
- 結構化欄位
- 共享標籤

這樣兼顧快速操作與後續資料分析。

## 10.6 評價是否匿名
- 對其他團主顯示匿名
- 平台管理員可追蹤實際評價人
- 若未來有爭議，平台可查來源

## 10.7 評價可見範圍
- 所有團主可見
- 場主可見
- 球員不可見

## 10.8 評價對排組影響
- 不直接影響排組演算法
- 只提供團主是否接受報名參考

## 10.9 爭議處理
雖然目前你說不做申訴機制，但系統層仍建議預留：
- `is_hidden`
- `hidden_reason`
- `hidden_by`

避免平台未來完全無法處理爭議內容。

---

# 11. 收費、試用、錢包、續費

## 11.1 個人團主方案
- 每個 Session 第一次成功按下開打才計費
- 建立 Session 不扣款
- 同一 Session 後續多輪不重複扣
- 金額：50 元

## 11.2 場主方案
- 月費：500 元 / 月
- 可提供試用期
- 試用期結束後自動續費

## 11.3 免費試用
- 採次數制
- 建議對象：個人團主或場主皆可設定
- 試用次數應寫入帳務規則，不應只寫死在前端

## 11.4 錢包
- 個人方案使用錢包
- 錢包支援：儲值、扣款、退款、贈點、手動調整
- 每筆交易都需有 immutable ledger

## 11.5 自動續費前需要準備的營運資料
正式接金流前，營運端至少需備妥：
1. 收款主體資料（公司 / 商號）
2. 統編 / 負責人資料
3. 銀行帳戶資料
4. 客服聯絡方式
5. 退款規則
6. 服務條款
7. 隱私政策
8. 會員訂閱條款
9. 試用轉正式訂閱說明文案
10. 失敗扣款與寬限期政策

## 11.6 月費到期處理
- 操作全鎖
- 不可新建 / 編輯資料
- 歷史資料原則上唯讀
- 若需匯出，由客服介入

---

# 12. 場館、球場、時段、申請

## 12.1 場館層級
- Venue：場館
- Court：球場 / 場地
- Slot：可開團時段模板

## 12.2 團主申請超額開團
若團主要超出場主設定自行開團：
1. 建立申請單
2. 狀態：pending / approved / rejected / cancelled
3. 通過前只能草稿，不得正式開打
4. 場主審核後方可生效

## 12.3 場地數量動態調整
- Session 可於進行中調整 court_count
- 調整後僅影響後續 round，不回改已完成 round

---

# 13. 通知

系統應預留通知模組，支援：
1. 報名成功
2. 候補遞補
3. 開打提醒
4. 訂閱續費提醒
5. 錢包扣款 / 餘額不足
6. 系統公告

初期可先站內通知，後續擴充 Email / LINE。

---

# 14. 主要資料表與設計原則

## 14.1 設計原則
1. 所有主表皆有 `id`, `created_at`, `updated_at`
2. 重要業務資料保留操作歷史
3. 重要狀態使用 enum
4. 關鍵查詢欄位加 index
5. FK 與 check constraint 要完整
6. 所有帳務資料不可只存結果，需可追溯來源

## 14.2 核心資料表群組

### 使用者 / 角色
- `app_user_profiles`
- `user_role_memberships`（若未來支援一人多角）

### 球員
- `players`
- `host_player_profiles`
- `host_player_level_adjustments`
- `player_shared_notes`
- `player_shared_note_history`
- `player_ratings`
- `player_rating_summary`

### 場館 / 團主管理
- `venues`
- `courts`
- `venue_host_memberships`
- `venue_time_slots`
- `host_session_requests`

### Session / 報名 / 候補
- `sessions`
- `session_participants`
- `session_waitlist_promotions`
- `session_events`

### 排組 / 對戰 / 比分
- `rounds`
- `matches`
- `match_teams`
- `match_team_players`
- `match_score_submissions`
- `assignment_recommendations`
- `assignment_recommendation_items`

### 帳務
- `billing_plans`
- `subscriptions`
- `wallet_accounts`
- `wallet_transactions`
- `usage_charges`
- `payment_provider_customers`
- `payment_provider_payment_methods`
- `payment_provider_events`

### 通知 / 稽核
- `notifications`
- `audit_logs`

---

# 15. RLS 原則

> 本文件不直接放完整 RLS SQL，但 AI Agent 必須依此原則撰寫 policy。

## 15.1 platform_admin
可讀寫所有表。

## 15.2 venue_owner
- 只能存取自己擁有場館及其相關資料
- 可看旗下 host 資料
- 可看共享備註與評價

## 15.3 host
- 只能管理自己建立的 Session
- 只能改自己的 host_player_profiles
- 可讀取共享備註與評價
- 可讀寫自己對球員建立的評價與共享備註

## 15.4 player
- 只能改自己的 player profile
- 只能看自己參與的 Session 必要資訊
- 只能回報自己有參與的 match 比分
- 不可看共享備註與評價

## 15.5 金流 webhook
外部金流 webhook 需使用 `service_role` 或後端安全通道處理，不走一般前端 token。

---

# 16. AI Agent 任務拆解順序

## 16.1 Phase 1：基礎資料庫
1. 建立 enum
2. 建立 helper functions
3. 建立核心 tables
4. 建立 FK / indexes / constraints
5. 建立 updated_at triggers

## 16.2 Phase 2：認證與角色
1. 串 Supabase Auth
2. 新增 profile onboarding
3. 建立 venue_owner / host / player 角色流程

## 16.3 Phase 3：場館與 Session
1. 場館與球場 CRUD
2. 團主 membership
3. Session CRUD
4. 報名 / 候補 / 遞補

## 16.4 Phase 4：排組引擎
1. 規則引擎 MVP
2. round / match 建立
3. AI suggestion wrapper
4. 人工改組與覆蓋流程

## 16.5 Phase 5：比分與歷史
1. 比分回報
2. 團主確認
3. 統計欄位與報表
4. 為 Elo 預留聚合視圖

## 16.6 Phase 6：帳務
1. 方案表
2. 錢包
3. usage charge
4. 訂閱 / 試用 / 自動續費
5. webhook

## 16.7 Phase 7：通知與後台
1. 站內通知
2. 後台報表
3. 匯出功能
4. 客服工具

---

# 17. 前端頁面最低需求

## 17.1 公開頁
- 產品介紹
- 方案頁
- 登入 / 註冊
- 服務條款 / 隱私政策

## 17.2 團主端
- Dashboard
- 固定名單 / 歷史球員
- Session 列表
- 建立 Session
- 報名管理
- 候補管理
- 分組頁
- Round 進行頁
- 比分確認頁
- 球員評價 / 共享備註頁
- 錢包 / 帳務頁

## 17.3 場主端
- 場館管理
- 場地管理
- 團主管理
- 申請審核
- 月費 / 訂閱
- 場館下歷史 Session

## 17.4 球員端
- 個人資料
- 我的報名
- 我的出席 Session
- 比分回報

---

# 18. 非功能需求

## 18.1 一致性
- 鎖定 round 與扣款必須具備 idempotency
- 比分確認需避免重複覆蓋

## 18.2 可追溯性
- 鎖定後所有變更必須寫入 audit log
- 共享備註需保留版本歷史

## 18.3 安全性
- 球員評價不可公開給球員
- 金流欄位不得直接從前端任意寫入
- 重要管理操作需 role 檢查

## 18.4 可擴充性
- 所有 client-facing 流程需 API First
- 不可將邏輯綁死在單一前端

---

# 19. 版本結論

本版文件已足以支撐：
1. 建立完整 PostgreSQL / Supabase schema
2. 撰寫 migration
3. 撰寫 RLS
4. 設計 API contract
5. 建立 Web 前端流程
6. 建立規則引擎 MVP
7. 串接金流與試用流程

若下一步要直接進工程實作，應立即輸出：
1. 完整 SQL schema
2. RLS policies SQL
3. seed data SQL
4. functions / triggers SQL
5. API contract 文件
6. 排組演算法 pseudocode

