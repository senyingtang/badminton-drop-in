# Auth 隔離整合測試（本機 Supabase，不連正式環境）

真 GoTrue（ES256、Email 確認開啟、SMTP→Mailpit）+ 真 Chrome；LINE 只模擬 access.line.me 與 token endpoint。

```bash
cd web/scripts/e2e/auth-local
npx supabase gen signing-key --algorithm ES256 > supabase/signing_keys.json   # 首次；JSON 需為陣列 [ {...} ]
npx supabase start                       # API 56821 / DB 56822 / Mailpit 56824
# 依序套用 docs/0*.sql（略過 diagnostics / verify / rollback）到 56822
# 用本機 URL / anon / service_role 建置並啟動：Next 於 :3105、vinext（vite preview）於 :8787
NODE_OPTIONS=--import=file:///<abs>/fake-line.mjs next start -p 3105          # 只有 LINE 測試需要
node auth-e2e.mjs http://localhost:3105   # 亦可 http://localhost:8787
node line-e2e.mjs http://localhost:3105
```
Site URL 故意設為 http://localhost:3999，用來證明「redirectTo 不在白名單會被導去 Site URL」。

## 雲端 Staging（不寄信部分）
```bash
PLAYWRIGHT_CORE_URL=... STAGING_SR_FILE=D:/project/secrets/staging-service-role.txt node cloud-e2e.mjs
```
信件連結以 admin generateLink 產生，只驗證連結處理；實際寄送需 SMTP 另行實測。

## M7.2 真實 LINE 登入（Staging）

- Staging LINE Login channel 設定在 Staging DB `platform_line_integration.login_channel_*`（值只存在 `D:\project\secrets\staging-line.env.txt`，不進 repo）；messaging 欄位保持空白 → Staging 不會發 LINE 推播。
- 真人登入後檢查：`STAGING_SR_FILE=D:/project/secrets/staging-service-role.txt node line-verify.mjs`（只讀；檢查 Auth user / profile / membership / players 綁定與重複）。
