-- 092 / 02：Phase 2 —— 在資料庫層暫停使用者可呼叫的計費 RPC
-- 狀態：提案，未執行。
--
-- ⚠️ 必須在「新版 App（M1.3，開放報名改走 kb_open_registration_no_charge）已部署到正式站」之後才可套用。
--    若先套用，舊版 App 按「開放報名」會得到 permission denied。
--
-- 收回後：
--   - 一般會員 / 團主無法再透過 RPC 觸發開放報名扣款、讀取他人配額 / 錢包（kb_get_quota_dashboard 可帶任意 p_user_id）。
--   - 平台管理員的錢包手動調整也暫停（App 端按鈕與 API 已停用）。
-- 不刪函式、不動資料。

begin;

do $$
declare
  r record;
  v_names text[] := array[
    'kb_open_registration_with_billing', -- 開放報名扣配額 / 錢包（App 改用 no_charge）
    'kb_get_quota_dashboard',            -- SECURITY DEFINER 且可傳任意 p_user_id（可讀他人錢包 / 配額）
    'kb_ensure_my_billing_account',      -- 只建立自己的帳務帳戶；暫停期間不需要
    'kb_admin_adjust_user_wallet'        -- 管理員調整錢包（暫停期間不產生新的錢包異動）
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
    raise notice '092 phase2: paused %', r.sig;
  end loop;
end
$$;

commit;
