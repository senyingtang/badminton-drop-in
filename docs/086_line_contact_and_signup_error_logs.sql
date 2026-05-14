-- 086_line_contact_and_signup_error_logs.sql
-- 1) 公開報名失敗紀錄表 public_signup_error_logs（供 /s/[code] 與 API 寫入）
-- 2) RLS：僅 platform_admin 可查；寫入由 service_role（Next API）繞過 RLS
-- Safe to re-run.

begin;

create table if not exists public.public_signup_error_logs (
  id uuid primary key default gen_random_uuid(),
  share_signup_code text null,
  session_id uuid null references public.sessions(id) on delete set null,
  user_id uuid null,
  flow text null,
  error_code text not null,
  error_message text null,
  error_detail jsonb not null default '{}'::jsonb,
  payload_snapshot jsonb not null default '{}'::jsonb,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_signup_error_logs_created_at
  on public.public_signup_error_logs (created_at desc);

create index if not exists idx_public_signup_error_logs_error_code
  on public.public_signup_error_logs (error_code, created_at desc);

create index if not exists idx_public_signup_error_logs_share_code
  on public.public_signup_error_logs (share_signup_code, created_at desc);

comment on table public.public_signup_error_logs is '公開報名頁（/s/[code]）失敗紀錄；由 API 以 service_role 寫入';

alter table public.public_signup_error_logs enable row level security;

drop policy if exists "Platform admin select public signup error logs" on public.public_signup_error_logs;
create policy "Platform admin select public signup error logs"
  on public.public_signup_error_logs
  for select
  using (public.is_platform_admin());

grant select on public.public_signup_error_logs to authenticated;
grant all on public.public_signup_error_logs to service_role;

commit;
