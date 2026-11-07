-- 092 / 99：Rollback（02 與 01）
-- 優先依 00_inspect_readonly.sql 存下的 proacl 快照逐一還原。
-- 下列為「回到套用前的 Supabase 預設狀態」的通用還原：
--   - 原 migration 未明確 GRANT 的函式 → 還原為 PUBLIC 可執行（Supabase 預設）
--   - 原 migration 明確 GRANT authenticated 的函式 → 還原 authenticated
-- ⚠️ 還原 01 等於重新開放「任何人扣任意錢包 / 自行入帳」的漏洞，只應在 01 造成未預期故障時短暫使用。

begin;

-- Rollback 02
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['kb_open_registration_with_billing','kb_get_quota_dashboard',
                                 'kb_ensure_my_billing_account','kb_admin_adjust_user_wallet'])
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    raise notice '092 rollback phase2: re-granted %', r.sig;
  end loop;
end
$$;

-- Rollback 01：權限
do $$
declare r record;
begin
  -- 原本即明確 GRANT authenticated（028）
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'kb_user_self_wallet_topup'
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  -- 原 migration 沒有 GRANT（依 PUBLIC 預設）
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'kb_wallet_debit_cents','kb_wallet_debit','kb_subscription_activate','kb_subscription_renew',
        'kb_create_personal_billing_account_if_missing','kb_resolve_billing_account_for_session',
        'kb_billing_consume_on_session_start','kb_billing_preflight_session_start',
        'apply_wallet_transaction','ensure_wallet_account','charge_session_first_start'])
  loop
    execute format('grant execute on function %s to public', r.sig);
    raise notice '092 rollback phase1: re-granted PUBLIC on %', r.sig;
  end loop;
end
$$;

-- Rollback 01：新函式
-- 注意：若新版 App 已部署，移除後「開放報名」會改走 App 內建的 RLS fallback（仍不扣費）。
drop function if exists public.kb_open_registration_no_charge(uuid);

commit;
