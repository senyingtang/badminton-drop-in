-- 092 / 01b：帳務資料「讀取」範圍收斂（M1.4）—— 會員只能看自己的帳務，團主／組織成員只能看有權限的帳務
-- 狀態：提案。只在本機 PGlite（repo migrations 001–053 建庫）測過，見 staging-test/。需經使用者核准才可執行。
--
-- 背景：依 migrations，005 的 kb_* 帳務表沒有啟用 RLS，Supabase 預設授權 anon / authenticated SELECT，
--       任何人（含 anon key）都能讀取所有人的錢包餘額、交易、訂閱、組織成員。
--       01 已收回「寫入」；本檔收斂「讀取」，讓錢包 UI 可以安全地恢復。
--
-- 這是 RLS 變更（啟用 RLS + 新增 SELECT policy），不改資料、不改函式行為：
--   - SECURITY DEFINER 函式以 owner 身分執行，不受 RLS 影響（開放報名、配額總覽、管理員調整等照常）。
--   - service_role 有 BYPASSRLS，後端 API 不受影響。
--   - 不新增任何 INSERT / UPDATE / DELETE policy（寫入仍由 01 收回，只能走後端或 DEFINER 函式）。
--
-- 對舊版 App（Vercel）相容：舊版使用者端只讀「自己的」交易（billing 頁）與「平台管理員」讀全部錢包（admin/users），
-- 兩者都由下列 policy 允許。
--
-- 可見範圍：
--   個人帳務帳戶：owner_user_id = 自己
--   組織帳務帳戶：該組織 is_active 的 owner / host / manager（與 052 開放報名授權同一組角色）
--   平台管理員：全部

begin;

-- 1) 授權判斷（SECURITY DEFINER，避免 policy 互相查詢造成 RLS 遞迴；只回傳 boolean）
create or replace function public.kb_can_view_billing_account(p_billing_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.is_platform_admin()
      or exists (
        select 1
        from public.kb_billing_accounts ba
        where ba.id = p_billing_account_id
          and (
            (ba.account_type = 'personal' and ba.owner_user_id = auth.uid())
            or (
              ba.account_type = 'organization'
              and exists (
                select 1
                from public.kb_organization_members m
                where m.organization_id = ba.organization_id
                  and m.user_id = auth.uid()
                  and m.is_active = true
                  and m.role in ('owner', 'host', 'manager')
              )
            )
          )
      )
    );
$$;

create or replace function public.kb_can_view_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.is_platform_admin()
      or exists (select 1 from public.kb_organizations o where o.id = p_organization_id and o.owner_user_id = auth.uid())
      or exists (
        select 1 from public.kb_organization_members m
        where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.is_active = true
      )
    );
$$;

create or replace function public.kb_can_view_wallet(p_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kb_wallets w
    where w.id = p_wallet_id and public.kb_can_view_billing_account(w.billing_account_id)
  );
$$;

revoke execute on function public.kb_can_view_billing_account(uuid) from public, anon;
revoke execute on function public.kb_can_view_organization(uuid) from public, anon;
revoke execute on function public.kb_can_view_wallet(uuid) from public, anon;
grant execute on function public.kb_can_view_billing_account(uuid) to authenticated, service_role;
grant execute on function public.kb_can_view_organization(uuid) to authenticated, service_role;
grant execute on function public.kb_can_view_wallet(uuid) to authenticated, service_role;

-- 2) 啟用 RLS（已啟用的表重複執行無副作用）＋ SELECT policy
do $$
declare
  t text;
begin
  foreach t in array array[
    'kb_billing_accounts', 'kb_wallets', 'kb_wallet_transactions',
    'kb_subscriptions', 'kb_subscription_periods', 'kb_quota_buckets', 'kb_quota_ledger',
    'kb_billing_charges', 'kb_billing_invoices', 'kb_billing_invoice_lines', 'kb_usage_events', 'kb_payment_methods',
    'kb_organizations', 'kb_organization_members', 'kb_plans', 'kb_plan_entitlements',
    'kb_system_settings', 'kb_feature_flags'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end
$$;

-- 個人 / 組織帳務帳戶
drop policy if exists kb092_billing_accounts_select on public.kb_billing_accounts;
create policy kb092_billing_accounts_select on public.kb_billing_accounts
  for select to authenticated using (public.kb_can_view_billing_account(id));

drop policy if exists kb092_wallets_select on public.kb_wallets;
create policy kb092_wallets_select on public.kb_wallets
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_wallet_transactions_select on public.kb_wallet_transactions;
create policy kb092_wallet_transactions_select on public.kb_wallet_transactions
  for select to authenticated using (public.kb_can_view_wallet(wallet_id));

drop policy if exists kb092_subscriptions_select on public.kb_subscriptions;
create policy kb092_subscriptions_select on public.kb_subscriptions
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_subscription_periods_select on public.kb_subscription_periods;
create policy kb092_subscription_periods_select on public.kb_subscription_periods
  for select to authenticated using (
    exists (select 1 from public.kb_subscriptions s
            where s.id = kb_subscription_periods.subscription_id
              and public.kb_can_view_billing_account(s.billing_account_id)));

drop policy if exists kb092_quota_buckets_select on public.kb_quota_buckets;
create policy kb092_quota_buckets_select on public.kb_quota_buckets
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_quota_ledger_select on public.kb_quota_ledger;
create policy kb092_quota_ledger_select on public.kb_quota_ledger
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_billing_charges_select on public.kb_billing_charges;
create policy kb092_billing_charges_select on public.kb_billing_charges
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_billing_invoices_select on public.kb_billing_invoices;
create policy kb092_billing_invoices_select on public.kb_billing_invoices
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_billing_invoice_lines_select on public.kb_billing_invoice_lines;
create policy kb092_billing_invoice_lines_select on public.kb_billing_invoice_lines
  for select to authenticated using (
    exists (select 1 from public.kb_billing_invoices i
            where i.id = kb_billing_invoice_lines.invoice_id
              and public.kb_can_view_billing_account(i.billing_account_id)));

drop policy if exists kb092_usage_events_select on public.kb_usage_events;
create policy kb092_usage_events_select on public.kb_usage_events
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

drop policy if exists kb092_payment_methods_select on public.kb_payment_methods;
create policy kb092_payment_methods_select on public.kb_payment_methods
  for select to authenticated using (public.kb_can_view_billing_account(billing_account_id));

-- 組織：成員可看組織與同組織成員名單；非成員看不到
drop policy if exists kb092_organizations_select on public.kb_organizations;
create policy kb092_organizations_select on public.kb_organizations
  for select to authenticated using (public.kb_can_view_organization(id));

drop policy if exists kb092_organization_members_select on public.kb_organization_members;
create policy kb092_organization_members_select on public.kb_organization_members
  for select to authenticated using (public.kb_can_view_organization(organization_id));

-- 方案目錄：登入者可讀（不含任何個人資料）
drop policy if exists kb092_plans_select on public.kb_plans;
create policy kb092_plans_select on public.kb_plans for select to authenticated using (true);

drop policy if exists kb092_plan_entitlements_select on public.kb_plan_entitlements;
create policy kb092_plan_entitlements_select on public.kb_plan_entitlements for select to authenticated using (true);

-- 系統設定 / 功能旗標：App 使用者端不讀；只開放平台管理員
drop policy if exists kb092_system_settings_select on public.kb_system_settings;
create policy kb092_system_settings_select on public.kb_system_settings for select to authenticated using (public.is_platform_admin());

drop policy if exists kb092_feature_flags_select on public.kb_feature_flags;
create policy kb092_feature_flags_select on public.kb_feature_flags for select to authenticated using (public.is_platform_admin());

-- 3) anon 不需要任何帳務資料
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and (c.relname ~ '^kb_(billing|wallet|subscription|quota|organization|plan|usage|payment_methods|payment_orders|system_settings|feature_flags|v_quota)')
  loop
    execute format('revoke select on %s from anon', r.rel);
  end loop;
end
$$;

-- 4) 會繞過 RLS 的 view：kb_v_quota_dashboard_personal（以 owner 身分讀取全部人的錢包 / 配額）。
--    App 不直接讀取；kb_get_quota_dashboard（DEFINER）內部仍可使用。
do $$
begin
  if to_regclass('public.kb_v_quota_dashboard_personal') is not null then
    revoke select on public.kb_v_quota_dashboard_personal from public, anon, authenticated;
    grant select on public.kb_v_quota_dashboard_personal to service_role;
  end if;
end
$$;

commit;
