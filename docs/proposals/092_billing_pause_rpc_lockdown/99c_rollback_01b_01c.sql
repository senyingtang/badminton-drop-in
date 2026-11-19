-- 092 / 99c：Rollback 01b（讀取範圍）與 01c（配額總覽越權修正）
--
-- ⚠️ 會重新開放「讀取」面的資訊外洩：
--   - 01b 回復後：若這些表在 092 之前沒有啟用 RLS，任何登入者（與 anon，若 00 快照顯示原本可讀）都能讀取所有人的錢包 / 交易 / 訂閱 / 組織成員。
--   - 01c 回復後：kb_get_quota_dashboard 可再次以任意 p_user_id 讀取他人帳務。
-- 不會重新開放寫入（01 維持）。只在 01b / 01c 造成正式站故障時使用。關閉 RLS 的範圍依 01b 寫入的 kb_audit_logs 紀錄（M9）。

begin;

-- 01c：移除包裝函式，原函式改回原名
do $$
begin
  if to_regprocedure('public.kb_get_quota_dashboard_unchecked(uuid)') is not null then
    drop function if exists public.kb_get_quota_dashboard(uuid);
    alter function public.kb_get_quota_dashboard_unchecked(uuid) rename to kb_get_quota_dashboard;
    grant execute on function public.kb_get_quota_dashboard(uuid) to authenticated, service_role;
  end if;
end
$$;

-- 01b：移除 092 新增的 SELECT policies
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and policyname like 'kb092\_%' escape '\'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$$;

-- 01b：只對「092 之前 RLS 為 false」的表關閉 RLS。
-- 下列清單為依 migrations 推定的狀態；執行前請以 00 的 G 段輸出核對，原本已啟用 RLS 的表請從清單移除。
-- M9：只關閉「01b 執行時由 off 改為 on」的表（kb_audit_logs.action_type = kb092_01b_rls_enabled）。
--     原本就啟用 RLS 的表維持啟用；沒有紀錄時不關閉任何表（只移除 policy → 會員讀不到帳務，但不會外洩）。
do $$
declare t text;
begin
  for t in
    select distinct jsonb_array_elements_text(new_data -> 'tables')
    from public.kb_audit_logs where action_type = 'kb092_01b_rls_enabled'
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I disable row level security', t);
      raise notice '99c: RLS disabled on % (was off before 01b)', t;
    end if;
  end loop;
  insert into public.kb_audit_logs (actor_user_id, action_type, target_entity_type, target_entity_id)
  values (null, 'kb092_99c_rollback', 'migration', null);
end
$$;

drop function if exists public.kb_can_view_wallet(uuid);
drop function if exists public.kb_can_view_billing_account(uuid);
drop function if exists public.kb_can_view_organization(uuid);

-- anon 的 SELECT 與 kb_v_quota_dashboard_personal 的權限：請依 00 快照（relacl）逐一還原；預設不還原。

commit;

-- 驗證（唯讀）：回滾後 01b / 01c 應為 false
--   select count(*) as kb092_policies from pg_policies where schemaname = 'public' and policyname like 'kb092\_%' escape '';   -- 0
--   select to_regprocedure('public.kb_get_quota_dashboard_unchecked(uuid)') is null as c01_rolled_back;                          -- true
--   或執行 093/97_patch_state_readonly.sql
