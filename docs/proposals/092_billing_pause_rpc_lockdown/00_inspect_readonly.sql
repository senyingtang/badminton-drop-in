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

-- G. 【P0 檢查】帳務資料表的 RLS 狀態與 anon / authenticated 的寫入權限
--    依 migrations，005 建立的 kb_* 帳務表「沒有 enable row level security」，Supabase 預設又授權 anon/authenticated ALL，
--    若 rls=false 且 *_write=true：任何持有 anon key 的人可直接 PATCH /rest/v1/kb_wallets 改餘額（函式 REVOKE 擋不住）。
select c.relname                                                        as table_name,
       c.relrowsecurity                                                 as rls_enabled,
       c.relforcerowsecurity                                            as rls_forced,
       has_table_privilege('anon', c.oid, 'SELECT')                     as anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE')
         or has_table_privilege('anon', c.oid, 'DELETE')               as anon_write,
       has_table_privilege('authenticated', c.oid, 'SELECT')            as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
         or has_table_privilege('authenticated', c.oid, 'DELETE')      as authenticated_write,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
       c.relacl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and (c.relname ~ '^kb_' or c.relname ~ '(wallet|subscription|usage_charges|billing_plans|payment_provider)')
order by c.relrowsecurity, c.relname;

-- H. 上述資料表的 RLS policies（確認 for all / for update 的範圍）
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (tablename ~ '^kb_' or tablename ~ '(wallet|subscription|usage_charges|billing_plans|payment_provider)')
order by tablename, policyname;

-- I. 非 postgres 擁有的帳務函式（owner 不同時，DEFINER 內部呼叫的權限要另外確認）
select p.oid::regprocedure as signature, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ~ '^kb_' or p.proname ~ '(wallet|billing|subscription|quota|topup|charge|debit)')
  and pg_get_userbyid(p.proowner) <> 'postgres';

-- J. 開放報名授權依據：組織成員資料（kb_organization_members 若可被任意寫入，052 的組織授權即可被偽造）
select m.role, m.is_active, count(*) from public.kb_organization_members m group by 1, 2 order by 1, 2;
