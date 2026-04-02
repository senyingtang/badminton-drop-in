# Badminton Working List - 羽球臨打排組平台開發清單

此文件記錄了本專案的開發進度、現狀以及未來的所有執行步驟與預期成效。

---

## 🟢 Phase 1: 基礎架構與認證 (已完成)

**完成日期：** 2026-04-02
**核心功能：**
- [x] **Next.js 15 專案初始化**：建立 App Router 架構。
- [x] **Supabase 整合**：配置 Server/Client 端連線。
- [x] **Auth 驗證系統**：
    - 登入、註冊頁面（Glassmorphism 設計）。
    - Middleware 路由保護（未登入跳轉、已登入防回跳）。
- [x] **側邊導覽與頂部狀態欄**：響應式 Layout，支援收合。
- [x] **Dashboard 概覽**：歡迎資訊、快速操作入口、配額卡片。

**參考檔案：**
- 資料庫基底：[001_base_schema.sql](file:///d:/project/badminton/docs/001_base_schema.sql)
- 權限控制：[002_rls_policies.sql](file:///d:/project/badminton/docs/002_rls_policies.sql)
- 系統設計詳解：[badminton_headless_sdd_v2.md](file:///d:/project/badminton/docs/badminton_headless_sdd_v2.md)

**預期成效：** 建立穩定的使用者身分識別系統與高質感的 UI 基礎，確保後續功能在受保護的環境下運行。

---

## 🟢 Phase 2: 場次管理核心 (已完成)

**完成日期：** 2026-04-02
**核心功能：**
- [x] **Profile 自動同步**：首次登入自動建立 `app_user_profiles` 以滿足外鍵約束。
- [x] **場次清單 (Sessions List)**：支援全部/進行中/已完成/已取消的分類篩選。
- [x] **建立場次流程**：
    - 簡易場館選擇（支援 inline 快速新增場館）。
    - 表單驗證與自動結束時間建議。
- [x] **場次詳情頁面**：
    - 資訊卡展示基本資訊與狀態流轉按鈕。
    - **即時同步 (Realtime)**：參與者名單變動、狀態切換皆會即時反映至所有分頁。
- [x] **參與者管理**：
    - 搜尋現有球員或 **Inline 建立新球員**。
    - 球員狀態管理（確認正選、設為候補、遞補、取消）。
    - 整合 `kb_` 前綴的 RPC 函數進行原子化資料操作。

**參考檔案：**
- 場次相關表：[001_base_schema.sql](file:///d:/project/badminton/docs/001_base_schema.sql) (sessions, session_participants)
- 核心業務邏輯：[004_functions_and_triggers.sql](file:///d:/project/badminton/docs/004_functions_and_triggers.sql) (confirm_participant_status, promote_next_waitlist_participant)

**預期成效：** 團主可以開始建立場次並管理球員名單，實現報名資訊的視覺化與即時同步。

---

## 🟢 Phase 3: 排組引擎與輪次運作 (已完成)

**完成日期：** 2026-04-02
**核心功能：**
- [x] **建立 Round 管理介面**：場次詳情頁下方新增輪次列表。
- [x] **開發排組引擎 (Rule Engine)**：實作「公平輪轉」演算法，確保每人出賽次數平均且級數相近。
- [x] **AI 建議整合**：提供排組建議與理由說明。
- [x] **Match 管理**：每輪產生多個球場的比對 (Matches)，支援拖拽微調球員。
- [x] **鎖定輪次 (Lock Round)**：觸發 `lock_round_and_increment_counters`，更新球員統計並觸發計費點。

**參考檔案：**
- 輪次與比賽結構：[001_base_schema.sql](file:///d:/project/badminton/docs/001_base_schema.sql) (rounds, matches, assignment_recommendations)
- 排組與計費點邏輯：[004_functions_and_triggers.sql](file:///d:/project/badminton/docs/004_functions_and_triggers.sql) (lock_round_and_increment_counters)
- 排組引擎規則：[badminton_headless_sdd_v2.md](file:///d:/project/badminton/docs/badminton_headless_sdd_v2.md) (Section 4: 排組引擎)

**預期成效：** 平台的靈魂功能。團主不再需要用腦袋或紙筆排組，一鍵產生公平且級數合理的對戰組合。

---

## 🟢 Phase 4: 比分回報與球員畫像 (已完成)

**完成日期：** 2026-04-02
**核心功能：**
- [x] **比分輸入組件**：場側回報介面，支援球員自行/團主輸入比分。
- [x] **團主核取機制**：團主確認比分後寫入正式賽果。
- [x] **球員個人頁面 (Profile)**：展示球員的歷史戰績、當前級數與團主私有備註。
- [x] **共享評價系統**：團主可對球員快捷標記（如：爽約、態度佳、級數高等）。

**參考檔案：**
- 球員 profile 與評價表：[001_base_schema.sql](file:///d:/project/badminton/docs/001_base_schema.sql) (host_player_profiles, player_ratings)
- 評價自動彙總邏輯：[004_functions_and_triggers.sql](file:///d:/project/badminton/docs/004_functions_and_triggers.sql) (refresh_player_rating_summary)
- 比分回報結構：[001_base_schema.sql](file:///d:/project/badminton/docs/001_base_schema.sql) (match_score_submissions)

**預期成效：** 累積球員的信用與級數數據，讓未來的排組精確度隨場次增加而提升。

---

## 🟡 Phase 5: 錢包與扣款系統 (進行中 - Next Step)

**預估步驟：**
1. [x] **核心計費結構**：執行 `005_billing_schema.sql`，建立方案與配額機制。
2. [x] **錢包前端組件**：開發 QuotaCard, WalletCard, TransactionList 與 BillingPreflightDialog。
3. [ ] **帳務總覽頁**：將上述組件整合進 `/billing` 頁面。
4. [ ] **方案升級入口**：實作 `/billing/upgrade` 讓免費團主能升級月費。
5. [ ] **Session 前置計費檢查 (Preflight)**：整合至 `RoundList.tsx` 開打流程中。

**參考檔案：**
- 錢包與計費架構：[005_billing_schema.sql](file:///d:/project/badminton/docs/005_billing_schema.sql)
- 計費設計說明：[badminton_subscription_billing_sdd_v1.md](file:///d:/project/badminton/docs/badminton_subscription_billing_sdd_v1.md)

**預期成效：** 達成 SaaS 平台的商務閉環，實現自動化計費管理與錢包儲值功能。

---

## ⚪ Phase 6: 場館深度管理與公開報名頁 (規劃中)

**預估步驟：**
1. **場館管理進階**：場館地址 Google Map、自訂「週五固定團」等時段模版。
2. **公開報名連結 (Public Landing `/s/[code]`)**：球員不需登入即可透過連結查看，登入即可自行加入正選或候補。
3. **球員自主回報 (`/my-matches`)**：開放被排組的球員透過手機自行回填比分，減輕紀錄台負擔。
4. **基礎通知推送**：透過 Notification 表紀錄並通知球員已遞補成功或報名成立。

**參考檔案：**
- 自行報名與回報邏輯：[badminton_headless_sdd_v2.md](file:///d:/project/badminton/docs/badminton_headless_sdd_v2.md)

**預期成效：** 建立 C 端球員參與迴圈，讓團務管理達到完全分散與自動化。

---

## ⚪ Phase 7: 通知中心與管理後台 (規劃中)

**預估步驟：**
1. **平台管理 Dashboard (`/admin`)**：站內總場次、活躍用戶與平台營收統計。
2. **通知抽屜 (Notification Center)**：前端全局建立即時小鈴鐺，支援 WebSocket 接收更新。
3. **客服與營運支援**：管理員後台修正錢包餘額、隱藏不當評價的功能。
4. **數據報表匯出**：匯出場次名單、帳務流水 (CSV 格式支援)。
5. **進階 Audit Log 追蹤**：稽查所有團主與管理員的重要操作歷程。

**預期成效：** 完成產品最後一哩路，確保平台後續維運與數據安全性。

---

## 🚀 最終預期成效

1. **對團主**：工作量減少 80%。自動排組、自動遞補、自動記分。
2. **對球員**：透明公平。知道自己跟誰打、什麼時候打，且歷史紀錄完整保留。
3. **對平台**：自動化維運。透過錢包系統與 SaaS 權限控管實現永續經營。
