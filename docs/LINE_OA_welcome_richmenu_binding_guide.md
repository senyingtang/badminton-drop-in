# LINE 官方帳號歡迎訊息、圖文選單與會員綁定設定指南

## 目標

將 LINE 官方帳號（LINE@）的加入好友歡迎訊息與圖文選單導向：

```txt
https://badminton-drop-in.vercel.app/member-dashboard
```

讓球員從 LINE 官方帳號進入會員中心，完成帳號／球員身份綁定，後續可接收候補遞補、名單異動、開打提醒等通知。

---

## 目前專案已具備的 LINE 相關資料庫設計

根據目前 `docs.zip` 內的 migration，專案已包含以下 LINE 相關資料結構：

### 1. `platform_line_integration`
來源：`039_platform_line_integration.sql`、`041_platform_line_oa_add_friend_and_public_rpc.sql`

用途：儲存平台級 LINE 設定。

重要欄位：

```sql
messaging_channel_id
messaging_channel_secret
messaging_channel_access_token
login_channel_id
login_channel_secret
oa_add_friend_url
```

說明：

- `messaging_channel_access_token`：後端呼叫 LINE Messaging API 推播用。
- `login_channel_id` / `login_channel_secret`：LINE Login 或 LIFF 綁定流程用。
- `oa_add_friend_url`：LINE 官方帳號加好友連結，可給公開報名頁使用。

---

### 2. `players.line_user_id`
來源：`013_players_public_handle_line.sql`

用途：儲存 LINE Login 回傳的使用者識別 `sub`。

```sql
players.line_user_id
```

適合用在：

- LINE Login 綁定
- LIFF 登入後綁定

---

### 3. `players.line_oa_user_id`
來源：`043_line_oa_binding_codes.sql`

用途：儲存 LINE 官方帳號 Messaging API 的 `userId`。

```sql
players.line_oa_user_id
```

適合用在：

- LINE OA 推播
- 候補轉正選通知
- 名單異動通知

---

### 4. `line_oa_binding_codes`
來源：`043_line_oa_binding_codes.sql`

用途：一次性綁定碼。

流程：

1. 使用者在網站產生綁定碼。
2. 使用者到 LINE 官方帳號聊天室輸入：

```txt
綁定 ABC123
```

3. LINE Webhook 收到訊息。
4. 後端用 service role 查 `line_oa_binding_codes`。
5. 寫入 `players.line_oa_user_id`。
6. 標記綁定碼已使用。

---

## 推薦綁定流程

### MVP 版本：圖文選單導向會員中心 + 綁定碼

這是目前最適合你的版本，因為資料庫已經支援 `line_oa_binding_codes`。

使用者流程：

1. 球員加入 LINE 官方帳號。
2. 收到歡迎訊息。
3. 點擊圖文選單「會員綁定」。
4. 進入：

```txt
https://badminton-drop-in.vercel.app/member-dashboard
```

5. 登入網站帳號。
6. 點擊「產生 LINE 綁定碼」。
7. 複製綁定碼。
8. 回到 LINE 官方帳號聊天室輸入：

```txt
綁定 ABC123
```

9. 系統完成綁定。

---

## LINE 官方帳號後台設定

### 一、修改加入好友歡迎訊息

進入：

```txt
LINE Official Account Manager
```

操作：

```txt
主頁 > 聊天相關 > 加入好友的歡迎訊息
```

建議歡迎訊息：

```txt
歡迎加入羽球臨打排組平台 🏸

請先完成會員綁定，之後才能收到候補遞補、正選通知、臨打名單異動與開打提醒。

👉 點選下方圖文選單「會員綁定」
或直接開啟：
https://badminton-drop-in.vercel.app/member-dashboard

若系統產生綁定碼，請回到此聊天室輸入：
綁定 你的綁定碼

例如：
綁定 ABC123
```

建議設定：

- 開啟歡迎訊息
- 儲存
- 用非管理員帳號測試加入好友

---

### 二、設定圖文選單

進入：

```txt
LINE Official Account Manager > 主頁 > 圖文選單 > 建立
```

建議設定：

```txt
圖文選單名稱：會員功能選單
顯示期間：長期或不設定結束日
選單列文字：開啟會員功能
預設顯示：開啟
```

圖文選單區塊建議：

```txt
會員綁定
報名查詢
候補狀態
臨打紀錄
聯絡客服
```

若先做 MVP，可以只做一格或三格。

「會員綁定」區塊動作：

```txt
動作類型：連結 / URL
URL：https://badminton-drop-in.vercel.app/member-dashboard
```

儲存後，記得啟用該圖文選單。

---

## 重要技術提醒

### 1. 直接導向 Vercel 網址，不等於 LINE 已完成綁定

如果圖文選單直接開：

```txt
https://badminton-drop-in.vercel.app/member-dashboard
```

這只能把使用者帶到網站，網站本身不一定知道該使用者的 LINE OA userId。

所以 MVP 必須搭配：

```txt
一次性綁定碼 + LINE Webhook
```

否則你的系統無法取得 `players.line_oa_user_id`，後續就不能主動推播通知。

---

### 2. 若未來要做到「點圖文選單自動綁定」，建議改成 LIFF

進階流程：

```txt
圖文選單 > LIFF URL > 取得 LINE userId > 自動寫入 players.line_oa_user_id / line_user_id
```

但這需要：

- LINE Login Channel
- LIFF App
- Callback URL
- 前端 LIFF SDK
- 後端驗證 ID Token

MVP 先不一定需要。

---

## Vercel / 網站端需要補的功能

### 1. 會員中心加入 LINE 綁定區塊

頁面：

```txt
/member-dashboard
```

需要顯示：

```txt
LINE 綁定狀態：已綁定 / 未綁定
產生綁定碼按鈕
綁定說明
```

---

### 2. 產生綁定碼 API

建議 API：

```txt
POST /api/line/binding-code
```

功能：

- 確認目前登入使用者對應的 player
- 產生 6 碼英數綁定碼
- 寫入 `line_oa_binding_codes`
- 設定過期時間，例如 10 分鐘

---

### 3. LINE Webhook API

建議 API：

```txt
POST /api/line/webhook
```

功能：

- 接收 LINE 訊息事件
- 判斷文字是否為：

```txt
綁定 ABC123
```

- 查詢 `line_oa_binding_codes`
- 檢查：
  - code 是否存在
  - 是否過期
  - 是否已使用
- 將 LINE `source.userId` 寫入：

```sql
players.line_oa_user_id
```

- 回覆綁定成功訊息

---

## LINE Developers 後台需要設定

### Messaging API Webhook URL

進入：

```txt
LINE Developers Console > Provider > Messaging API Channel > Messaging API
```

設定：

```txt
Webhook URL：https://badminton-drop-in.vercel.app/api/line/webhook
Use webhook：啟用
```

同時確認：

```txt
Channel access token 已建立
Channel secret 已取得
```

這兩個要放到 Vercel Environment Variables 或 Supabase `platform_line_integration`。

---

## 建議 Vercel 環境變數

```env
LINE_MESSAGING_CHANNEL_ID=
LINE_MESSAGING_CHANNEL_SECRET=
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

注意：

```txt
SUPABASE_SERVICE_ROLE_KEY 不可暴露到前端。
```

---

## 最小可行版本待辦清單

### LINE 後台

- [ ] 修改加入好友歡迎訊息
- [ ] 建立圖文選單
- [ ] 圖文選單「會員綁定」導向 `/member-dashboard`
- [ ] LINE Developers 啟用 Webhook

### 網站端

- [ ] `/member-dashboard` 顯示 LINE 綁定狀態
- [ ] 建立 `POST /api/line/binding-code`
- [ ] 建立 `POST /api/line/webhook`
- [ ] Webhook 支援「綁定 <code>」
- [ ] 綁定成功後寫入 `players.line_oa_user_id`

### 資料庫

- [ ] 確認已執行：`013_players_public_handle_line.sql`
- [ ] 確認已執行：`039_platform_line_integration.sql`
- [ ] 確認已執行：`041_platform_line_oa_add_friend_and_public_rpc.sql`
- [ ] 確認已執行：`043_line_oa_binding_codes.sql`

---

## 建議測試流程

1. 用測試 LINE 帳號加入官方帳號。
2. 確認歡迎訊息有出現。
3. 點擊圖文選單會員綁定。
4. 確認可進入 `/member-dashboard`。
5. 登入網站。
6. 產生 LINE 綁定碼。
7. 回 LINE 聊天室輸入：

```txt
綁定 ABC123
```

8. 檢查 `players.line_oa_user_id` 是否成功寫入。
9. 從後端測試推播一則訊息給該 userId。
