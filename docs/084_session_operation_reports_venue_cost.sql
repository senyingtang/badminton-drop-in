-- 084_session_operation_reports_venue_cost.sql
-- 營運報表：獨立「場地費」欄位（cents），納入總支出與淨收入計算（由 API 寫入 gross/net）。
-- Run after docs/083_session_operation_reports.sql。不刪既有欄位。

begin;

-- 1) 欄位：預設 0，既有列自動為 0，不破壞舊資料
alter table public.session_operation_reports
  add column if not exists venue_cost_cents bigint not null default 0;

comment on column public.session_operation_reports.venue_cost_cents is '084: 場地費（分）；總支出 = venue + shuttlecock + other_expense。';

-- 2) check：非負（若已存在同名 constraint 則略過）
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'session_operation_reports'
      and c.conname = 'chk_sor_venue_cost_nonneg'
  ) then
    alter table public.session_operation_reports
      add constraint chk_sor_venue_cost_nonneg check (venue_cost_cents >= 0);
  end if;
end $$;

-- 3) 本表無 total_expense_cents 儲存欄；net_revenue_cents / gross_revenue_cents 為 API 計算寫入，非 generated。
--    若曾手動改 DB 造成淨收入與公式不一致，可選擇性重算（取消註解後執行）：
-- update public.session_operation_reports r
-- set net_revenue_cents = r.gross_revenue_cents - coalesce(r.venue_cost_cents, 0) - coalesce(r.shuttlecock_cost_cents, 0) - coalesce(r.other_expense_cents, 0)
-- where r.deleted_at is null;

commit;
