# 048 LINE 登入卡在登入頁 Debug / 修正說明

## 高機率原因

目前 `src/app/api/auth/line/callback/route.ts` 有一個常見失敗點：

1. 使用者按 LINE 登入。
2. LINE 回傳 `email` 或系統產生 `line+<sub>@example.com`。
3. 後端嘗試 `admin.auth.admin.createUser({ email })`。
4. 若該 email 已經存在 Supabase Auth，`createUser` 會失敗。
5. 目前程式直接導回 `/login?error=line_user_create_failed...`。
6. 但登入頁沒有顯示 query string 的 `error`，所以使用者看到的現象就是「授權後又回到登入頁」。

另外，必須檢查兩個後台設定：

- LINE Developers Console 的 LINE Login Callback URL 必須包含：
  `https://badminton-drop-in.vercel.app/api/auth/line/callback`
- Supabase Auth Redirect URLs 必須允許：
  `https://badminton-drop-in.vercel.app/auth/callback`

## 建議立即修正

1. 套用本資料夾內的 `route.ts` 到：
   `web/src/app/api/auth/line/callback/route.ts`

2. 套用本資料夾內的 `login-page.tsx` 到：
   `web/src/app/(auth)/login/page.tsx`

3. Vercel 環境變數必須有：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

4. 後台資料表 `platform_line_integration` 必須有：
   - `login_channel_id`
   - `login_channel_secret`

## 測試方式

### A. LINE Login callback 設定測試

直接打開：

```text
https://badminton-drop-in.vercel.app/api/auth/whoami
```

未登入時應回：

```json
{"ok":true,"hasUser":false}
```

LINE 登入完成後再打開，應回：

```json
{"ok":true,"hasUser":true}
```

### B. 登入錯誤可視化

若仍回到登入頁，網址會出現：

```text
/login?error=xxx
```

修正後登入頁會顯示錯誤，不會再「看起來沒原因」。
