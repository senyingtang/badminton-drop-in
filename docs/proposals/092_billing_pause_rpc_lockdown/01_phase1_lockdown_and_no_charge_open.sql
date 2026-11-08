-- 092 / 01：Phase 1 —— 收回高權限錢包 RPC + 帳務表直接寫入權 + 新增「不扣費開放報名」函式
-- 狀態：提案。只在本機 PGlite（repo migrations 001–053 建庫）測過，見 staging-test/。
--       需經使用者核准後才可在 Staging / Production 執行。
--
-- 必須在「新版 App 部署之前」套用：新版 App 的開放報名只呼叫 kb_open_registration_no_charge（已移除 RLS fallback）。
-- 對舊版 App（Vercel 正式站）安全：
--   - 本檔收回的函式，舊版與新版 App 都沒有以 anon / authenticated 身分直接呼叫
--     （service_role 路由與 SECURITY DEFINER 內部呼叫不受影響，因為 DEFINER 函式以 owner 身分執行）。
--   - kb_open_registration_with_billing 仍維持可呼叫（舊版 App 開放報名仍可運作、仍會扣費；收回放在 02）。
--   - 第 3 段只收回帳務資料表的 INSERT / UPDATE / DELETE / TRUNCATE。舊版與新版 App 的使用者端只「讀」這些表，
--     寫入全部走 service_role API 或 SECURITY DEFINER 函式；SELECT 不變。
--
-- 不刪除函式、不修改資料表結構、不修改 RLS policy 或 RLS 開關、不動任何錢包餘額或交易紀錄。

begin;

-- 1) 僅限內部 / service_role 使用的高權限函式：收回 PUBLIC / anon / authenticated
--    以名稱處理所有 overload；Production 不存在的函式會自動略過。
do $$
declare
  r record;
  v_names text[] := array[
    'kb_wallet_debit_cents',                         -- 扣任意 billing account 錢包（無身分檢查）
    'kb_wallet_debit',                               -- 舊版扣款（無身分檢查）
    'kb_subscription_activate',                      -- 為任意帳戶啟用方案 / 配額（無身分檢查）
    'kb_subscription_renew',                         -- 為任意訂閱續期並扣款（無身分檢查）
    'kb_create_personal_billing_account_if_missing', -- 為任意使用者建立帳務帳戶（無身分檢查）
    'kb_resolve_billing_account_for_session',        -- 會寫入 sessions.billing_account_id
    'kb_billing_consume_on_session_start',           -- 舊版開打扣配額（App 已不呼叫）
    'kb_billing_preflight_session_start',            -- 舊版開打預檢（App 已不呼叫）
    'apply_wallet_transaction',                      -- 004 舊錢包模型（無身分檢查）
    'ensure_wallet_account',                         -- 004 舊錢包模型（無身分檢查）
    'charge_session_first_start',                    -- 004 舊開打扣款
    'kb_user_self_wallet_topup'                      -- 使用者自行「模擬入帳」，每次最多 20000（App 未使用）
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
    raise notice '092 phase1: locked down %', r.sig;
  end loop;
end
$$;

-- 2) 不扣費開放報名：權限與狀態檢查與 kb_open_registration_with_billing（052）相同，
--    但不呼叫配額 / 錢包，也不寫入任何帳務紀錄。
create or replace function public.kb_open_registration_no_charge(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.sessions%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  -- 與 052 相同：場次 host，或該場次 organization 帳務帳戶的 owner / host / manager
  if v_session.host_user_id is distinct from v_user_id then
    if v_session.billing_account_id is null then
      raise exception 'NO_PERMISSION';
    end if;
    if not exists (
      select 1
      from public.kb_billing_accounts ba
      join public.kb_organizations o on o.id = ba.organization_id
      join public.kb_organization_members m on m.organization_id = o.id
      where ba.id = v_session.billing_account_id
        and ba.account_type = 'organization'
        and m.user_id = v_user_id
        and m.is_active = true
        and m.role in ('owner', 'host', 'manager')
    ) then
      raise exception 'NO_PERMISSION';
    end if;
  end if;

  if v_session.status = 'registration_open' then
    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'charged_by', 'already_open',
                              'session_status', v_session.status);
  end if;

  if v_session.status not in ('draft', 'pending_confirmation') then
    raise exception 'INVALID_SESSION_STATUS';
  end if;

  update public.sessions
  set status = 'registration_open',
      allow_self_signup = true,
      registration_opened_at = coalesce(registration_opened_at, now()),
      updated_at = now()
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'session_id', p_session_id, 'charged_by', 'none_billing_paused',
                            'session_status', 'registration_open');
end;
$$;

revoke execute on function public.kb_open_registration_no_charge(uuid) from public, anon;
grant execute on function public.kb_open_registration_no_charge(uuid) to authenticated, service_role;

-- 3) 帳務資料表：收回 anon / authenticated 的直接寫入權（P0）
--    依 migrations，005 建立的 kb_* 帳務表沒有啟用 RLS，而 Supabase 預設授權 anon / authenticated ALL：
--    可用 anon key 直接 PATCH /rest/v1/kb_wallets 改餘額，或把自己加進 kb_organization_members 取得組織的開放報名權。
--    只收回寫入；不動 SELECT、不動 RLS。service_role 與 DEFINER 函式不受影響。
--    排除使用者端 App 確實會寫入、且已有 RLS policy 的表：
--      kb_payment_provider_configs（管理後台金流設定）、kb_audit_logs、kb_admin_audit_logs、kb_notifications。
do $$
declare
  r record;
  v_tables text[] := array[
    'kb_wallets', 'kb_wallet_transactions',
    'kb_quota_buckets', 'kb_quota_ledger',
    'kb_subscriptions', 'kb_subscription_periods', 'kb_subscription_invoices', 'kb_subscription_events',
    'kb_billing_accounts', 'kb_billing_charges', 'kb_billing_invoices', 'kb_billing_invoice_lines', 'kb_billing_events',
    'kb_organizations', 'kb_organization_members',
    'kb_plans', 'kb_plan_entitlements', 'kb_usage_events', 'kb_payment_methods', 'kb_payment_orders',
    'kb_system_settings', 'kb_feature_flags',
    -- 004 舊錢包 / 訂閱模型（App 已不使用；wallet_accounts 的 policy 是 for all owner，擁有者可自改餘額）
    'wallet_accounts', 'wallet_transactions', 'subscriptions', 'usage_charges', 'billing_plans',
    'payment_provider_events', 'payment_provider_customers', 'payment_provider_payment_methods'
  ];
begin
  for r in
    select c.oid::regclass as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = any (v_tables)
  loop
    execute format('revoke insert, update, delete, truncate on table %s from public, anon, authenticated', r.tbl);
    execute format('grant select, insert, update, delete on table %s to service_role', r.tbl);
    raise notice '092 phase1: table writes locked %', r.tbl;
  end loop;
end
$$;

commit;
