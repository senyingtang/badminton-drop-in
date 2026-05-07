# LINE OA keyword-only webhook（綁定/解除綁定）

本系統的 LINE OA webhook **只處理「綁定/解除綁定」關鍵字**，不處理一般聊天與客服對話。

原因：LINE OA Manager 本身已提供 Manual chat、Response hours、Auto-response messages 等客服能力，**不在本系統重複實作**。

## 系統行為（重要）

- **只回覆以下關鍵字**
  - `綁定`
  - `我要綁定`
  - `綁定 ABC123`（6 碼英數）
  - `解除綁定`
- **其他任何訊息一律不回覆**
  - webhook 仍會 `return 200`
  - **不呼叫 LINE Reply API**
  - 交由 LINE OA Manager 的 Manual chat / Auto-response / Response hours 處理

## 綁定流程（使用者）

1. 在網站會員中心產生綁定碼（效期 10 分鐘）
2. 加入「羽球排組平台」LINE@ 官方帳號
3. 回到 LINE@ 聊天室輸入：
   - `綁定 ABC123`
4. 綁定成功後，名單異動/候補遞補/開打提醒會透過 LINE 通知

## Webhook 規格（開發）

- **Regex**：`/^綁定\s+([A-Za-z0-9]{6})$/`
- 文字前處理：
  - trim 前後空白
  - 全形空白（U+3000）→ 半形空白
  - 合併多個空白
- code 轉 uppercase 後查詢 `public.line_oa_binding_codes`

### 綁定碼狀態回覆

- code 不存在：
  - `找不到此綁定碼，請確認是否輸入正確。`
- code 已過期：
  - `此綁定碼已逾期，請回會員中心重新產生。`
- code 已使用：
  - `此綁定碼已使用。若需要重新綁定，請回會員中心重新產生新的綁定碼。`
- code 有效：
  - 更新：
    - `line_oa_binding_codes.status=used`
    - `line_oa_binding_codes.used_at=now()`
    - `line_oa_binding_codes.line_oa_user_id=event.source.userId`
    - `players.line_oa_user_id`
    - 若 `app_user_profiles.line_oa_user_id` 欄位存在，同步更新
  - 回覆成功訊息

### 解除綁定

- 關鍵字：`解除綁定`
- 行為：
  - 用 `event.source.userId` 查 `players.line_oa_user_id` / `app_user_profiles.line_oa_user_id`
  - 若存在就清除（設為 null）
  - 回覆解除成功；若不存在回覆「目前尚未綁定」

## 建議設定（LINE OA / LINE Developers）

### LINE OA Manager

- **Response hours**：依客服時間設定
- **During response hours**：`Manual chat + auto-response messages`
- **Outside response hours**：`Auto-response messages`
- 內建 auto-response 可用於一般客服提示（例如「請到網站產生綁定碼」）

### LINE Developers

- **Webhook**：Enabled
- **Webhook URL**：`https://badminton-drop-in.vercel.app/api/line/webhook`

