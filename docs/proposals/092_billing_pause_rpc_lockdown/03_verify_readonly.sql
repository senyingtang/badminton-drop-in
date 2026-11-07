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
