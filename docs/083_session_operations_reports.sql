-- 083_session_operations_reports.sql
-- 場次結束營運報表（每場次最多一筆未刪除報表；soft delete）。
-- 與既有 host_operation_reports（038 手動試算）並存；本表以 session 為核心。
-- Run in Supabase SQL Editor after 038/057. Idempotent where possible.

begin;

-- ---------------------------------------------------------------------------
-- 1) Table session_operation_reports
-- ---------------------------------------------------------------------------
create table if not exists public.session_operation_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  host_user_id uuid not null references public.app_user_profiles (id) on delete restrict,
  venue_id uuid references public.venues (id) on delete set null,
  report_date date not null,
  expected_paid_players integer,
  expected_fee_cents bigint,
  actual_paid_players integer not null,
  actual_fee_cents bigint not null,
  shuttlecock_used numeric(14, 4),
  shuttlecock_unit_cost_cents bigint,
  other_income_cents bigint not null default 0,
  other_expense_cents bigint not null default 0,
  gross_revenue_cents bigint not null,
  shuttlecock_cost_cents bigint not null default 0,
  net_revenue_cents bigint not null,
  note text,
  source text not null default 'session_end',
  created_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  updated_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  deleted_by_user_id uuid references public.app_user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_sor_actual_players_nonneg check (actual_paid_players >= 0),
  constraint chk_sor_expected_players_nonneg check (expected_paid_players is null or expected_paid_players >= 0),
  constraint chk_sor_actual_fee_nonneg check (actual_fee_cents >= 0),
  constraint chk_sor_expected_fee_nonneg check (expected_fee_cents is null or expected_fee_cents >= 0),
  constraint chk_sor_other_income_nonneg check (other_income_cents >= 0),
  constraint chk_sor_other_expense_nonneg check (other_expense_cents >= 0),
  constraint chk_sor_shuttle_unit_nonneg check (shuttlecock_unit_cost_cents is null or shuttlecock_unit_cost_cents >= 0),
  constraint chk_sor_shuttle_used_nonneg check (shuttlecock_used is null or shuttlecock_used >= 0),
  constraint chk_sor_gross_nonneg check (gross_revenue_cents >= 0),
  constraint chk_sor_shuttle_cost_nonneg check (shuttlecock_cost_cents >= 0),
  constraint chk_sor_net_any check (net_revenue_cents is not null)
);

create unique index if not exists ux_session_operation_reports_session_active
  on public.session_operation_reports (session_id)
  where deleted_at is null;

create index if not exists idx_session_operation_reports_host_created
  on public.session_operation_reports (host_user_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_session_operation_reports_report_date
  on public.session_operation_reports (report_date desc)
  where deleted_at is null;

drop trigger if exists trg_session_operation_reports_updated_at on public.session_operation_reports;
create trigger trg_session_operation_reports_updated_at
before update on public.session_operation_reports
for each row execute function public.set_updated_at();

alter table public.session_operation_reports enable row level security;

drop policy if exists sor_select_host_or_admin on public.session_operation_reports;
create policy sor_select_host_or_admin
  on public.session_operation_reports
  for select
  using (host_user_id = auth.uid() or public.is_platform_admin());

drop policy if exists sor_insert_host on public.session_operation_reports;
create policy sor_insert_host
  on public.session_operation_reports
  for insert
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_id
        and s.host_user_id = host_user_id
        and (s.host_user_id = auth.uid() or public.is_platform_admin())
    )
  );

drop policy if exists sor_update_host on public.session_operation_reports;
create policy sor_update_host
  on public.session_operation_reports
  for update
  using (host_user_id = auth.uid() or public.is_platform_admin())
  with check (host_user_id = auth.uid() or public.is_platform_admin());

-- 不使用 true DELETE；以 UPDATE deleted_at 軟刪（policy 允許 update）
drop policy if exists sor_no_delete on public.session_operation_reports;
create policy sor_no_delete
  on public.session_operation_reports
  for delete
  using (false);

grant select, insert, update on public.session_operation_reports to authenticated;
grant all on public.session_operation_reports to service_role;

comment on table public.session_operation_reports is '083: 場次結束營運報表（cents）；每 session 未刪除最多一筆。';

commit;
