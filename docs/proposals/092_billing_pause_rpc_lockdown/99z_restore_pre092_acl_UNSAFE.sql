-- 092 / 99z：⚠️ 完整還原到 092 之前的權限狀態（UNSAFE，會重新開放 P0 漏洞）
--
-- 執行後：
--   - 任何人（anon key）都能再次執行 kb_wallet_debit_cents 等函式，扣任意帳戶的錢包、啟用任意方案。
--   - anon / authenticated 可再次直接寫入 kb_wallets 等帳務表（如果這些表的 RLS 沒有開啟）。
-- 只在以下情況使用：092 造成無法以 99a / 99b 修復的正式站故障，且已取得使用者明確書面核准。
-- 執行後請盡快重新套用 01。
-- 優先以 00_inspect_readonly.sql 存下的 proacl / relacl 快照逐一還原；本檔是「Supabase 預設狀態」的通用版本。

begin;

-- 還原 02
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
  end loop;
end
$$;

-- 還原 01：函式權限
do $$
declare r record;
begin
  -- 原 migration（028）明確 GRANT authenticated
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'kb_user_self_wallet_topup'
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  -- 原 migration 沒有 GRANT（Supabase 預設：PUBLIC 與 anon / authenticated 皆可執行）
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
    execute format('grant execute on function %s to public, anon, authenticated', r.sig);
  end loop;
end
$$;

-- 還原 01：資料表寫入權（Supabase 預設 ALL）
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as tbl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname = any (array[
        'kb_wallets','kb_wallet_transactions','kb_quota_buckets','kb_quota_ledger',
        'kb_subscriptions','kb_subscription_periods','kb_subscription_invoices','kb_subscription_events',
        'kb_billing_accounts','kb_billing_charges','kb_billing_invoices','kb_billing_invoice_lines','kb_billing_events',
        'kb_organizations','kb_organization_members','kb_plans','kb_plan_entitlements','kb_usage_events',
        'kb_payment_methods','kb_payment_orders','kb_system_settings','kb_feature_flags',
        'wallet_accounts','wallet_transactions','subscriptions','usage_charges','billing_plans',
        'payment_provider_events','payment_provider_customers','payment_provider_payment_methods'])
  loop
    execute format('grant insert, update, delete, truncate on table %s to anon, authenticated', r.tbl);
  end loop;
end
$$;

-- 新函式：只有在新版 App 尚未上線時才移除（新版 App 的開放報名需要它）
-- drop function if exists public.kb_open_registration_no_charge(uuid);

commit;
