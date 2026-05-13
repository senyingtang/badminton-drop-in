-- 084_session_operation_reports_venue_cost_diagnostics.sql
-- Read-only：venue_cost_cents 與淨收入公式抽樣。

-- 1) session_operation_reports 欄位
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_operation_reports'
order by ordinal_position;

-- 2) venue_cost_cents 是否存在
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'session_operation_reports'
    and column_name = 'venue_cost_cents'
) as venue_cost_cents_exists;

-- 3) 最近 20 筆（未刪除）金額欄位
select id,
       session_id,
       actual_paid_players,
       actual_fee_cents,
       venue_cost_cents,
       shuttlecock_used,
       shuttlecock_unit_cost_cents,
       shuttlecock_cost_cents,
       other_income_cents,
       other_expense_cents,
       gross_revenue_cents,
       net_revenue_cents,
       deleted_at
from public.session_operation_reports
where deleted_at is null
order by created_at desc
limit 20;

-- 4) venue_cost_cents < 0（應為 0 筆）
select count(*) as n_negative_venue
from public.session_operation_reports
where venue_cost_cents < 0;

-- 5) 淨收入公式抽樣：expected_net = gross - venue - shuttle - other_expense
select id,
       gross_revenue_cents,
       venue_cost_cents,
       shuttlecock_cost_cents,
       other_expense_cents,
       net_revenue_cents,
       (
         gross_revenue_cents
         - coalesce(venue_cost_cents, 0)
         - coalesce(shuttlecock_cost_cents, 0)
         - coalesce(other_expense_cents, 0)
       ) as expected_net,
       (
         net_revenue_cents
         - (
           gross_revenue_cents
           - coalesce(venue_cost_cents, 0)
           - coalesce(shuttlecock_cost_cents, 0)
           - coalesce(other_expense_cents, 0)
         )
       ) as net_delta
from public.session_operation_reports
where deleted_at is null
order by created_at desc
limit 50;
