-- 092 / 99c：Rollback 01b（讀取範圍）與 01c（配額總覽越權修正）
--
-- ⚠️ 會重新開放「讀取」面的資訊外洩：
--   - 01b 回復後：若這些表在 092 之前沒有啟用 RLS，任何登入者（與 anon，若 00 快照顯示原本可讀）都能讀取所有人的錢包 / 交易 / 訂閱 / 組織成員。
--   - 01c 回復後：kb_get_quota_dashboard 可再次以任意 p_user_id 讀取他人帳務。
-- 不會重新開放寫入（01 維持）。只在 01b / 01c 造成正式站故障時使用，並以 00 的 G 段快照為準決定哪些表要 disable RLS。

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
do $$
declare t text;
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
      execute format('alter table public.%I disable row level security', t);
    end if;
  end loop;
end
$$;

drop function if exists public.kb_can_view_wallet(uuid);
drop function if exists public.kb_can_view_billing_account(uuid);
drop function if exists public.kb_can_view_organization(uuid);

-- anon 的 SELECT 與 kb_v_quota_dashboard_personal 的權限：請依 00 快照（relacl）逐一還原；預設不還原。

commit;
