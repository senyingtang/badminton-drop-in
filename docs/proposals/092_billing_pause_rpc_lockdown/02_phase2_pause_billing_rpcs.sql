-- 092 / 02：Phase 2 —— 收回使用者端可直接觸發「扣款 / 帳務寫入」的 RPC（M1.4 修訂）
-- 狀態：提案。只在本機 PGlite 測過，見 staging-test/。需經使用者核准才可執行。
--
-- ⚠️ 必須在「新版 App（開放報名改走 kb_open_registration_no_charge）已部署到所有仍連正式 DB 的前端」之後才可套用。
--    若先套用，舊版 App 按「開放報名」會得到 permission denied。
--
-- M1.4 修訂：錢包 UI 恢復為唯讀，因此「不再」收回下列兩個函式：
--   - kb_get_quota_dashboard：改由 01c 修正越權（只能查自己，管理員可查他人），帳務頁與 QuotaCard 需要它。
--   - kb_ensure_my_billing_account：只能為自己建立帳務帳戶（auth.uid()），無越權。
--
-- 收回：
--   - kb_open_registration_with_billing：開放報名扣配額 / 錢包。暫停收費期間由 kb_open_registration_no_charge 取代；
--     恢復收費時以新的 migration 重新授權（或改版函式），不必改 App 以外的架構。
--   - kb_admin_adjust_user_wallet：管理員從瀏覽器直接改錢包。往後錢包寫入只走後端 API
--     （/api/admin/users/adjust-wallet，service_role + 平台管理員檢查 + 稽核紀錄），且須等 BILLING_WRITES_ENABLED 開啟。
-- 不刪函式、不動資料。可重複執行。

begin;

do $$
declare
  r record;
  v_names text[] := array[
    'kb_open_registration_with_billing',
    'kb_admin_adjust_user_wallet'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_names)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    raise notice '092 phase2: revoked user execute on %', r.sig;
  end loop;
end
$$;

commit;
