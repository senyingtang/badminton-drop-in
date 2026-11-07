-- 092 / 01：Phase 1 —— 收回高權限錢包 RPC + 新增「不扣費開放報名」函式
-- 狀態：提案，未在任何環境執行。需經使用者核准後才可在 Production 執行。
--
-- 可在「新版 App 部署之前」安全套用：
--   - 本檔收回的函式，App 都沒有以 anon / authenticated 身分直接呼叫
--     （service_role 路由與 SECURITY DEFINER 內部呼叫不受影響，因為 DEFINER 函式以 owner 身分執行）。
--   - kb_open_registration_with_billing 仍維持可呼叫（舊版 App 開放報名仍可運作；收回放在 02）。
--
-- 不刪除函式、不修改資料表、不修改 RLS、不動任何錢包餘額或交易紀錄。

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

commit;
