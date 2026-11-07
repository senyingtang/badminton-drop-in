-- 092 / 00：唯讀盤點（Production 可安全執行；不修改任何資料或權限）
-- 請把每個查詢結果存檔，作為套用 01 / 02 前的權限快照與 rollback 依據。

-- A. kb_wallet_debit_cents 完整簽名與定義
select p.oid::regprocedure as signature,
       p.prosecdef         as security_definer,
       pg_get_userbyid(p.proowner) as owner,
       p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'kb_wallet_debit_cents';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'kb_wallet_debit_cents';

-- B. 所有錢包 / 計費 / 訂閱相關函式：SECURITY DEFINER 與 anon / authenticated 的 EXECUTE 權限
select p.oid::regprocedure                                   as signature,
       p.prosecdef                                           as security_definer,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role_exec,
       pg_get_userbyid(p.proowner)                           as owner,
       p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ~ '^kb_'
    or p.proname ~ '(wallet|billing|subscription|quota|topup|charge|debit|payment)'
  )
order by p.prosecdef desc, authenticated_exec desc, 1;

-- C. 所有「SECURITY DEFINER 且 anon 或 authenticated 可執行」的 public 函式（全站，不限計費）
select p.oid::regprocedure as signature,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))
order by 1;

-- D. 呼叫端檢查：哪些「非 SECURITY DEFINER」函式在原始碼中呼叫 01 將收回權限的函式
--    （結果應為空；若有，套用 01 前需先評估）
select p.oid::regprocedure as invoker_function, t.name as calls
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join unnest(array[
  'kb_wallet_debit_cents','kb_wallet_debit','kb_subscription_activate','kb_subscription_renew',
  'kb_create_personal_billing_account_if_missing','kb_resolve_billing_account_for_session',
  'kb_billing_consume_on_session_start','kb_billing_preflight_session_start',
  'apply_wallet_transaction','ensure_wallet_account','charge_session_first_start',
  'kb_user_self_wallet_topup'
]) as t(name)
where n.nspname = 'public'
  and not p.prosecdef
  and p.proname <> t.name
  and p.prosrc ~* ('\m' || t.name || '\s*\(');

-- E. Supabase 預設權限（新函式是否自動授權 anon / authenticated）
select pg_get_userbyid(d.defaclrole) as grantor_role, d.defaclobjtype, d.defaclacl
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public' and d.defaclobjtype = 'f';

-- F. 錢包餘額與交易筆數快照（套用前後比對，確認「不改變既有餘額」）
select count(*) as wallets,
       sum(balance) as sum_balance,
       sum(balance_cents) as sum_balance_cents
from public.kb_wallets;

select count(*) as wallet_txns, max(created_at) as last_txn_at
from public.kb_wallet_transactions;
