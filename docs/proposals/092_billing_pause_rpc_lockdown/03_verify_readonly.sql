-- 092 / 03：套用後驗證（唯讀）
-- 預期：anon_exec / authenticated_exec 皆為 false；service_role_exec 為 true。

select p.oid::regprocedure as signature,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    -- Phase 1
    'kb_wallet_debit_cents','kb_wallet_debit','kb_subscription_activate','kb_subscription_renew',
    'kb_create_personal_billing_account_if_missing','kb_resolve_billing_account_for_session',
    'kb_billing_consume_on_session_start','kb_billing_preflight_session_start',
    'apply_wallet_transaction','ensure_wallet_account','charge_session_first_start',
    'kb_user_self_wallet_topup',
    -- Phase 2（僅在套用 02 後檢查）
    'kb_open_registration_with_billing','kb_get_quota_dashboard',
    'kb_ensure_my_billing_account','kb_admin_adjust_user_wallet'
  ])
order by 1;

-- 新函式：authenticated 應為 true、anon 應為 false
select p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'kb_open_registration_no_charge';

-- 核心場次 RPC 權限未被影響（應維持套用前的值）
select p.oid::regprocedure as signature,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    'self_signup_to_session_by_share_code','self_register_guest_friends_by_share_code',
    'self_cancel_guest_registration_by_registrar','get_public_session_roster_by_share_code',
    'lock_round_and_increment_counters','session_prepare_for_host'
  ])
order by 1;

-- 錢包餘額 / 交易筆數：與 00 的快照比對，應完全相同
select count(*) as wallets, sum(balance) as sum_balance, sum(balance_cents) as sum_balance_cents
from public.kb_wallets;
select count(*) as wallet_txns, max(created_at) as last_txn_at
from public.kb_wallet_transactions;

-- 帳務資料表：01 之後 anon_write / authenticated_write 應全部為 false；SELECT 與 RLS 狀態應與 00 的 G 段相同。
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE')
         or has_table_privilege('anon', c.oid, 'DELETE')                         as anon_write,
       has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
         or has_table_privilege('authenticated', c.oid, 'DELETE')                as authenticated_write,
       has_table_privilege('authenticated', c.oid, 'SELECT')                      as authenticated_select,
       has_table_privilege('service_role', c.oid, 'UPDATE')                       as service_role_update
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
order by 1;

-- App 使用者端仍需寫入的表：應維持原狀（01 不處理）
select c.relname, has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any (array['kb_payment_provider_configs','kb_audit_logs','kb_admin_audit_logs','kb_notifications',
                             'sessions','session_participants'])
order by 1;

-- 01b：帳務表 RLS 應全部啟用，且每張表至少有一條 kb092_ SELECT policy（kb_system_settings / kb_feature_flags 為管理員限定）
select c.relname, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname like 'kb092\_%' escape '\') as kb092_policies,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any (array['kb_billing_accounts','kb_wallets','kb_wallet_transactions','kb_subscriptions','kb_subscription_periods',
    'kb_quota_buckets','kb_quota_ledger','kb_billing_charges','kb_billing_invoices','kb_billing_invoice_lines','kb_usage_events',
    'kb_payment_methods','kb_organizations','kb_organization_members','kb_plans','kb_plan_entitlements','kb_system_settings','kb_feature_flags'])
order by 1;

-- 01b：會繞過 RLS 的 view 不可被 authenticated / anon 讀取（應為 false / false）
select has_table_privilege('authenticated', 'public.kb_v_quota_dashboard_personal', 'SELECT') as authenticated_select,
       has_table_privilege('anon', 'public.kb_v_quota_dashboard_personal', 'SELECT') as anon_select
where to_regclass('public.kb_v_quota_dashboard_personal') is not null;

-- 01c：包裝函式存在、原函式只給 service_role（應為 true / false / true）
select to_regprocedure('public.kb_get_quota_dashboard(uuid)') is not null as wrapper_exists,
       has_function_privilege('authenticated', 'public.kb_get_quota_dashboard_unchecked(uuid)', 'execute') as unchecked_authenticated_exec,
       has_function_privilege('service_role', 'public.kb_get_quota_dashboard_unchecked(uuid)', 'execute') as unchecked_service_exec
where to_regprocedure('public.kb_get_quota_dashboard_unchecked(uuid)') is not null;

-- 01d：角色防護 trigger 存在（應為 1 列，tgenabled = 'O'）
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.app_user_profiles'::regclass and tgname = 'trg_kb092_guard_profile_privileged_columns';

-- 04：付款入帳函式只給 service_role（應為 false / true），唯一索引存在
select has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'kb_payment_order_mark_paid';
select indexname from pg_indexes where schemaname = 'public' and indexname = 'uq_kb_wallet_txn_payment_order';
