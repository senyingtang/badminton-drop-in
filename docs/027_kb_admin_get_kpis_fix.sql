-- kb_admin_get_kpis 原本查 public.kb_ledger_lines，若未部署該表會 42P01 導致管理後台 KPI 失敗。
-- 改以 kb_wallet_transactions 中超額扣款筆數加總作為「已入帳金流」近似值（可日後再換精準營收口徑）。

create or replace function public.kb_admin_get_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_sessions integer;
  v_active_hosts integer;
  v_total_revenue numeric;
begin
  if not public.is_platform_admin() then
    raise exception 'Access denied';
  end if;

  select count(*)::integer into v_total_sessions from public.sessions;

  select count(distinct host_user_id)::integer into v_active_hosts
  from public.sessions
  where created_at > now() - interval '30 days';

  select coalesce(sum(abs(wt.amount)), 0) into v_total_revenue
  from public.kb_wallet_transactions wt
  where wt.txn_type = 'debit_overage';

  return jsonb_build_object(
    'total_sessions', v_total_sessions,
    'active_hosts_30d', v_active_hosts,
    'total_revenue_twd', v_total_revenue
  );
end;
$$;

grant execute on function public.kb_admin_get_kpis() to authenticated, service_role;
