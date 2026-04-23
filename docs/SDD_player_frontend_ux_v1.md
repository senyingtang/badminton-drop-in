## SDD v1：球員前台（無管理權限）UI/UX 重構

> **Date**: 2026-04-23  
> **Scope**: 「一般使用者（player）」登入後的前台介面（不含後台管理功能）  
> **Goal**: 讓球員登入後只看到「會員中心 / 全台臨打 / 臨打報名」，並與 WordPress 式「前台/後台」心智模型一致

---

### 1. 背景與問題

目前系統的路由與 UI 以 Next.js 的「同一套 App」呈現，造成一般球員登入後仍可能看到後台導覽（即使路由層已阻擋）。  
使用者心智模型（比照 WordPress）需要：

- **前台（球員）**：會員中心與報名體驗為主
- **後台（管理）**：`/dashboard` 等管理頁僅管理角色可進

本 SDD 定義球員前台的資訊架構、導航形式、權限切割與頁面規格。

---

### 2. 角色與權限定義

資料來源：`public.app_user_profiles.primary_role`（enum `app_role`）。

- **管理角色（Management）**：`platform_admin` / `venue_owner` / `host`
  - 可進入後台：`/dashboard`, `/sessions`, `/venues`, `/pickup-group/*`, `/players`, `/billing`, `/settings`, `/admin/*`
- **一般球員（Player）**：`player`
  - 只可使用前台：`/member-dashboard`（及其子頁）、公開報名頁（登入後才可報名）

> 注意：路由層需「進不去」，UI 層需「看不到」。兩者缺一不可。

---

### 3. 路由規劃（前台）

#### 3.1 前台入口（球員）

- `GET /member-dashboard`：會員中心首頁
- `GET /member-dashboard/line-binding`：LINE@ 通知綁定（已存在）
- `GET /member-dashboard/dropins`：全台臨打（新頁面）
- `GET /member-dashboard/dropins/[id]`：臨打團詳細（可選，後續）

#### 3.2 臨打報名（沿用分享連結入口）

- `GET /s/[code]`：場次報名入口（已存在）
  - 若未登入：導向 `/login?returnTo=/s/[code]`
  - 若已登入：顯示報名表單並可送出

> 「臨打報名」在前台導航上呈現為按鈕/連結，導向「貼入或選擇」分享連結（或由全台臨打列表直接點進去）。

---

### 4. 導航與版面（UI 方案）

本次採「前台/後台兩套導覽樣式可共存」，避免球員看到後台側欄。

#### 方案 A（建議）：球員前台使用 Header / Footer 導航

- **Header**（固定於頂部）
  - Logo（回 `/member-dashboard`）
  - 導航：會員中心、全台臨打、臨打報名
  - 右側：通知鈴（可選）、使用者選單（登出、設定）
- **Footer**
  - 條款/隱私/客服聯絡（可選）

優點：
- 更符合「一般網頁前端」心智
- 行動端更友善（不用側欄）

#### 方案 B：球員前台使用簡化 Sidebar

- 僅三個項目：會員中心 / 全台臨打 / 臨打報名
- 不顯示任何後台項目

> 若你偏好目前版面一致性，可採 B；若要更像一般網站，採 A。

---

### 5. 權限守門（必做）

#### 5.1 Middleware（路由層）

目標：`player` 進入後台路由 → 強制導向 `/member-dashboard`

- 後台路由前綴：
  - `/dashboard`, `/sessions`, `/venues`, `/pickup-group`, `/players`, `/billing`, `/settings`
- 判斷 role：
  - `primary_role in (platform_admin, venue_owner, host)` → allow
  - `primary_role = player` → redirect `/member-dashboard`

> 這已在現行 `middleware` 有方向，但本 SDD 要求「後台入口與預設導向」也需依角色分流。

#### 5.2 UI（顯示層）

球員端永遠不渲染後台 sidebar items；管理端永遠不渲染球員前台 header items（或至少清楚區隔）。

---

### 6. 頁面規格（球員前台）

#### 6.1 `/member-dashboard`（會員中心）

目的：呈現球員身份資訊與重要動作。

- 區塊 1：通知綁定（LINE@）
  - 已綁定：顯示 ✓ 已綁定
  - 未綁定：顯示風險提示 +「產生綁定代碼」按鈕
- 區塊 2：球員代碼（player_code）
  - 顯示 player_code
  - 若尚未建立：引導至設定或完成一次報名
- 區塊 3（後續）：我的報名紀錄（近 5 筆）

#### 6.2 `/member-dashboard/dropins`（全台臨打）

目的：以球員視角探索臨打團/場次，並導向報名。

v1 先做 UI 骨架與互動（資料先以 mock / 後續接 DB）：
- 搜尋（關鍵字：團名/縣市）
- 篩選（縣市、日期、費用區間）
- 清單卡片（團名、縣市、下次場次時間、費用、加入 LINE@ 提示）
- CTA：
  - 「前往報名」→ 導到對應的 `/s/[code]`
  - 「加入 LINE@」→ 使用 `oa_add_friend_url`

資料接法（後續 Phase）：
- 方案 1：建立公開 read-only view / RPC（anon 可讀）
- 方案 2：建立 Next.js `/api/public/dropins` 代理（同源）

#### 6.3 `/s/[code]`（臨打報名）

v1 行為（沿用現況）：
- 未登入 → 強制導去 `/login?returnTo=/s/[code]`
- 已登入 → 顯示報名表單
- 未綁 LINE → 報名前顯示免責告知（仍可報名）

---

### 7. 互動與狀態（State Machine）

#### 7.1 登入後導向

- `role = player` → `/member-dashboard`
- `role in management` → `/dashboard`

#### 7.2 會員前台導覽可見性

- `role = player`：只顯示前台 Header/Footer（或簡化 sidebar）
- `role in management`：顯示後台 sidebar（現行樣式）

---

### 8. 非功能性需求（NFR）

- **RWD**：手機端 header 導航需可折疊（hamburger）
- **效能**：前台首頁與全台臨打頁需避免大量阻塞查詢；清單採分頁或 lazy load
- **安全**：後台路由必須被 middleware 擋住；不可僅靠 UI 隱藏
- **可觀測性**：保留 `/api/version`；`/api/auth/whoami` 後續需限制（僅非 production 或僅管理員）

---

### 9. 實作步驟（可驗收）

#### Phase P1：前台導覽與版面切割
- 建立球員前台 Layout（Header/Footer 或簡化 sidebar）
- 管理端維持現有 sidebar
- 角色分流導向（登入後）

#### Phase P2：全台臨打頁 UI 骨架
- `/member-dashboard/dropins` 頁面
- 搜尋/篩選 UI + 卡片清單

#### Phase P3：資料串接（待商議）
- 公開資料模型與 API（RPC 或 Next API）
- 清單分頁與快取策略

---

### 10. 驗收清單（最重要）

- 使用 `player` 登入後：
  - 只能看到「會員中心 / 全台臨打 / 臨打報名」導航
  - 手動輸入 `/dashboard` 會被導回 `/member-dashboard`
- 使用 `host`/`platform_admin` 登入後：
  - 可看到後台 sidebar
  - 可正常進入 `/dashboard` 與管理頁

